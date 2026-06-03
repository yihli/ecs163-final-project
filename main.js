const svg = d3.select("#map-svg");

const width = window.innerWidth;
const height = window.innerHeight;

svg.attr("viewBox", `0 0 ${width} ${height}`);

document.getElementById("jump-to-map-btn").addEventListener("click", function () {
    document.getElementById("map-area").scrollIntoView({ behavior: "smooth" });
});

let year = -1;
let mapGroup;
let projection;
let dataPoints;
let zoomLevel = 1;
let selectedId = null;  // added: track clicked point

d3.select("#year-slider").on("input", function () {
    year = event.target.value;
    d3.select("#year-label").text(year);
    updateOperationsPoints(dataPoints.filter(d => d["Year"] == year));
});

d3.select("#year-show-all-button").on("click", function () {
    if (year != -1) {
        year = -1;
        d3.select("#year-label").text("1989–2021");
        d3.select("#year-slider-container").style("display", "none");
        d3.select("#year-show-all-button").text("Filter by year");
        updateOperationsPoints(dataPoints);
    } else {
        year = 1989;
        d3.select("#year-label").text("1989");
        d3.select("#year-slider-container").style("display", "flex");
        d3.select("#year-show-all-button").text("Show all years");
        updateOperationsPoints(dataPoints.filter(d => d["Year"] == year));
    }
});

// added: reset button
d3.select("#reset-button").on("click", function () {
    year = -1;
    d3.select("#year-label").text("1989–2021");
    d3.select("#year-slider-container").style("display", "none");
    d3.select("#year-show-all-button").text("Filter by year");
    d3.select("#year-slider").property("value", 2021);
    d3.select("#terrain-filter").property("value", "all");
    d3.select("#modality-filter").property("value", "all");
    clearDetails();
    updateOperationsPoints(dataPoints);
});

Promise.all([
    d3.json("countries-50m.json"),
    d3.csv("Military_Operations_Strategic_cleaned_coordinates.csv"),
    d3.json("rivers.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    d3.json("lakes.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    d3.json("urban_areas.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    d3.csv("display_cities.csv").catch(() => [])  // changed: csv + graceful fallback
]).then(([world, locations, rivers, lakes, urban, cities]) => {
    const outline = { type: "Sphere" };

    dataPoints = locations;
    d3.select("#record-count").text(locations.length);  // added: record count

    projection = d3.geoEqualEarth();
    projection.fitSize([width, height], outline);
    // Shift the projection down so Antarctica lands exactly at the SVG bottom edge
    const [tx, ty] = projection.translate();
    const [, ySouth] = projection([0, -89]);
    projection.translate([tx, ty + (height - ySouth)]);

    const path = d3.geoPath(projection);
    const graticule = d3.geoGraticule10();
    const land = topojson.feature(world, world.objects.land);
    const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
    const countries = topojson.feature(world, world.objects.countries);

    drawMap({ svg, path, outline, graticule, land, borders, countries, locations, projection, rivers, lakes, urban, cities });
});

function updateOperationsPoints(newOperations) {
    const points = mapGroup.selectAll(".operation-point").data(newOperations);

    points.exit().remove();

    const entered = points.enter()
        .append("circle")
        .attr("class", "operation-point")
        .attr("fill", "red")
        .attr("stroke", "black")
        .style("cursor", "pointer")
        .on("click", function (d) {  // added: click to inspect
            selectedId = d.ID;
            showOperationDetails(d);
            highlightSelected();
        });

    entered.append("title").text(d =>
        `${d.Operation}\n${d.Parent}\n${d.Year}\nLatitude: ${d.Latitude_Clean}\nLongitude: ${d.Longitude_Clean}`);

    entered.merge(points)
        .attr("cx", d => projection([+d.Longitude_Clean, +d.Latitude_Clean])[0])
        .attr("cy", d => projection([+d.Longitude_Clean, +d.Latitude_Clean])[1])
        .attr("r", 5 / zoomLevel)
        .attr("stroke-width", 0.5 / zoomLevel);

    highlightSelected();
}

// added: highlight selected point
function highlightSelected() {
    if (!mapGroup) return;
    mapGroup.selectAll(".operation-point")
        .attr("fill", d => d.ID === selectedId ? "#b4231c" : "red")
        .attr("r", d => (d.ID === selectedId ? 7 : 5) / zoomLevel)
        .attr("stroke-width", d => (d.ID === selectedId ? 2 : 0.5) / zoomLevel);
}

// added: details panel helpers
const MODALITIES = [["Drones","Drones"],["Air to air","Air-to-air"],["Cruise missiles","Cruise missiles"],["Aerial bombing","Aerial bombing"],["Close air support","Close air support"],["Ground troops","Ground troops"],["Paramil","Paramilitary"]];
const TERRAINS = [["Urban","Urban"],["Forest","Forest"],["Mountain","Mountain"]];

function esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function row(k, v) { return (v && v !== "NaN") ? `<div class="op-row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>` : ""; }

function clearDetails() {
    selectedId = null;
    d3.select("#details-panel").html('<p class="details-empty">Click a point on the map.</p>');
    if (mapGroup) highlightSelected();
}

function showOperationDetails(d) {
    const coords = `${(+d.Latitude_Clean).toFixed(3)}, ${(+d.Longitude_Clean).toFixed(3)}`;
    const dates = (d.Start && d.End) ? `${d.Start} → ${d.End}` : (d.Start || "");
    const modTags = MODALITIES.filter(([col]) => String(d[col]).trim() === "1").map(([,lbl]) => `<span class="op-tag">${esc(lbl)}</span>`).join("");
    const terrTags = TERRAINS.filter(([col]) => String(d[col]).trim() === "1").map(([,lbl]) => `<span class="op-tag terrain">${esc(lbl)}</span>`).join("");
    d3.select("#details-panel").html(`
        <div class="op-name">${esc(d.Operation)}</div>
        <div class="op-parent">${d.Parent && d.Parent !== d.Operation ? "Part of " + esc(d.Parent) : "Standalone operation"}</div>
        <div class="op-rows">
            ${row("Year", d.Year)}${row("Dates", dates)}${row("Duration", d["Duration (days)"] ? d["Duration (days)"] + " days" : "")}
            ${row("Coordinates", coords)}${row("Civilian cas.", d["Civilian casualties"])}${row("US cas.", d["US casualties"])}
        </div>
        ${modTags + terrTags ? `<div class="op-tags">${modTags}${terrTags}</div>` : ""}
    `);
}

function drawMap({ svg, path, outline, graticule, land, borders, countries, locations, projection, rivers, lakes, urban, cities }) {
    mapGroup = svg.append("g").attr("class", "map-group");

    const isMac = /mac/i.test(navigator.platform);
    const zoom = d3.zoom()
        .scaleExtent([1, 50])
        .filter(function () {
            // Wheel only zooms with Cmd (Mac) or Ctrl (Win/Linux); plain scroll scrolls the page
            if (d3.event.type === "wheel") return isMac ? d3.event.metaKey : d3.event.ctrlKey;
            return !d3.event.button;
        })
        .on("zoom", function () {
            zoomLevel = d3.event.transform.k;
            mapGroup.attr("transform", d3.event.transform);
            mapGroup.selectAll(".country-label").attr("font-size", d => Math.sqrt(path.area(d)) / 10);
            mapGroup.selectAll(".city").style("display", d3.event.transform.k > 6 ? "block" : "none");
            highlightSelected();  // added: keep highlight in sync on zoom
        });

    svg.call(zoom);

    mapGroup.append("path").datum(outline).attr("d", path).attr("fill", "#9ecae1");
    mapGroup.append("path").datum(graticule).attr("d", path).attr("stroke", "#ccc").attr("fill", "none");
    mapGroup.append("path").datum(land).attr("d", path).attr("fill", "#d8c59a");
    mapGroup.append("path").datum(borders).attr("d", path).attr("fill", "none").attr("stroke", "#000").attr("stroke-width", "0.25px").attr("opacity", "0.5");
    mapGroup.append("path").datum(outline).attr("d", path).attr("fill", "none").attr("stroke", "#000");

    mapGroup.selectAll(".river").data(rivers.features).enter().append("path")
        .attr("class", "river").attr("d", path).attr("fill", "none").attr("stroke", "#4292c6").attr("stroke-width", 0.25);

    mapGroup.selectAll(".lake").data(lakes.features).enter().append("path")
        .attr("class", "lake").attr("d", path).attr("fill", "#4292c6").attr("stroke", "#4292c6").attr("stroke-width", 0.25);

    mapGroup.selectAll(".urban").data(urban.features).enter().append("path")
        .attr("class", "urban").attr("d", path).attr("fill", "orange").attr("stroke", "orange").attr("stroke-width", 0.25);

    mapGroup.selectAll(".country-label")
        .data(countries.features.filter(d => path.area(d) > 70))
        .enter().append("text")
        .attr("class", "country-label")
        .attr("x", d => path.centroid(d)[0])
        .attr("y", d => path.centroid(d)[1])
        .attr("font-size", d => Math.sqrt(path.area(d)) / 10)
        .attr("text-anchor", "middle")
        .attr("fill", "blue")
        .attr("pointer-events", "none")
        .text(d => d.properties.name || d.id);

    // changed: display_cities.csv uses lat/lon/city_name fields
    const cityGroups = mapGroup.selectAll(".city")
        .data(cities.filter(c => c.latitude && c.longitude))
        .enter().append("g")
        .attr("class", "city")
        .style("display", "none")
        .attr("transform", d => {
            const [x, y] = projection([+d.longitude, +d.latitude]);
            return `translate(${x},${y})`;
        });

    cityGroups.append("circle").attr("r", 0.5).attr("fill", "gray");
    cityGroups.append("text").attr("y", 2).attr("font-size", "1px").attr("text-anchor", "middle").text(d => d.city_name);

    updateOperationsPoints(locations);
}
