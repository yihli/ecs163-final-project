const svg = d3.select("#map-svg");

const width = window.innerWidth;
const height = window.innerHeight;

svg.attr("viewBox", `0 0 ${width} ${height}`);

document.getElementById("jump-to-map-btn").addEventListener("click", function () {
    document.getElementById("map-area").scrollIntoView({ behavior: "smooth" });
});

let year = -1;
let modality = "all";
let terrain = "all";
let mapGroup;
let projection;
let dataPoints;
let zoomLevel = 1;
let selectedId = null;  // added: track clicked point
let casualtyMode = false;
let maxTotalCasualties = 1;
const casualtySizeScale = d3.scaleSqrt().range([5, 25]);
const civilianRatioColorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 1]);
let showingAdvancedDetailsView = false

d3.select("#year-slider").on("input", function () {
    year = this.value;
    d3.select("#year-label").text(year);
    updateOperationsPoints();
});

d3.select("#year-show-all-button").on("click", function () {
    if (year != -1) {
        year = -1;
        d3.select("#year-label").text("1989–2021");
        d3.select("#year-slider-container").style("display", "none");
        d3.select("#year-show-all-button").text("Filter by year");
        updateOperationsPoints();
    } else {
        year = 1989;
        d3.select("#year-label").text("1989");
        d3.select("#year-slider-container").style("display", "flex");
        d3.select("#year-show-all-button").text("Show all years");
        updateOperationsPoints();
    }
});

d3.select("#modality-filter").on("change", function () {
    modality = this.value
    updateOperationsPoints();
})

d3.select("#terrain-filter").on("change", function () {
    terrain = this.value
    updateOperationsPoints();
})


d3.select("#casualty-toggle").on("click", function () {
    casualtyMode = !casualtyMode;
    d3.select(this).classed("active", casualtyMode);
    d3.select("#casualty-legend").style("display", casualtyMode ? "flex" : "none");
    d3.select("#casualty-size-legend").style("display", casualtyMode ? "flex" : "none");
    updateOperationsPoints(year === -1 ? dataPoints : dataPoints.filter(d => d["Year"] == year));
});

// added: reset button
d3.select("#reset-button").on("click", function () {
    year = -1;
    modality = "all";
    terrain = "all";
    d3.select("#year-label").text("1989–2021");
    d3.select("#year-slider-container").style("display", "none");
    d3.select("#year-show-all-button").text("Filter by year");
    d3.select("#year-slider").property("value", 2021);
    d3.select("#terrain-filter").property("value", "all");
    d3.select("#modality-filter").property("value", "all");
    clearDetails();
    updateOperationsPoints();
});

Promise.all([
    d3.json("countries-50m.json"),
    d3.csv("Military_Operations_Strategic_cleaned_version_2.csv"),
    d3.json("rivers.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    d3.json("lakes.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    d3.json("urban_areas.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    d3.csv("display_cities.csv").catch(() => [])  // changed: csv + graceful fallback
]).then(([world, locations, rivers, lakes, urban, cities]) => {
    const outline = { type: "Sphere" };

    console.log(locations)
    dataPoints = locations;
    d3.select("#record-count").text(locations.length);  // added: record count
    maxTotalCasualties = d3.max(locations, d => (+d["Side A casualties"] || 0) + (+d["Side B casualties"] || 0) + (+d["Civilian casualties"] || 0)) || 1;
    casualtySizeScale.domain([0, maxTotalCasualties]);
    drawSizeLegend();

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

function parseCasualties(d) {
    const sideA = +d["Side A casualties"] || 0;
    const sideB = +d["Side B casualties"] || 0;
    const civilian = +d["Civilian casualties"] || 0;
    const us = +d["US casualties"] || 0;
    const hasData = d["Side A casualties"] !== "" || d["Side B casualties"] !== "" || d["Civilian casualties"] !== "" || d["US casualties"] !== "";
    const total = sideA + sideB + civilian;
    const ratio = total > 0 ? civilian / total : 0;
    return { sideA, sideB, civilian, us, total, ratio, hasData };
}

function getCasualtyFill(d) {
    const { hasData, ratio } = parseCasualties(d);
    return hasData ? civilianRatioColorScale(ratio) : "#999";
}

function updateOperationsPoints() {
    let newOperations = dataPoints
    if (year != -1) {
        newOperations = newOperations.filter(d =>
            d["Year"] == year
        )
    }

    if (modality != "all") {
        newOperations = newOperations.filter(d =>
            d[modality] == 1
        )
    }

    if (terrain != "all") {
        newOperations = newOperations.filter(d =>
            d[terrain] == 1
        )
    }

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
        .attr("r", d => casualtyMode ? casualtySizeScale(parseCasualties(d).total) / zoomLevel : 5 / zoomLevel)
        .attr("fill", d => casualtyMode ? getCasualtyFill(d) : "red")
        .attr("stroke-width", 0.5 / zoomLevel);

    highlightSelected();
}

// added: highlight selected point
function highlightSelected() {
    if (!mapGroup) return;
    mapGroup.selectAll(".operation-point")
        .attr("fill", d => d.ID === selectedId ? "#b4231c" : (casualtyMode ? getCasualtyFill(d) : "red"))
        .attr("r", d => {
            if (casualtyMode) {
                const base = casualtySizeScale(parseCasualties(d).total);
                return (d.ID === selectedId ? base * 1.4 : base) / zoomLevel;
            }
            return (d.ID === selectedId ? 7 : 5) / zoomLevel;
        })
        .attr("stroke-width", d => (d.ID === selectedId ? 2 : 0.5) / zoomLevel);
}

// added: details panel helpers
const MODALITIES = [["Drones", "Drones"], ["Air to air", "Air-to-air"], ["Cruise missiles", "Cruise missiles"], ["Aerial bombing", "Aerial bombing"], ["Close air support", "Close air support"], ["Ground troops", "Ground troops"], ["Paramil", "Paramilitary"]];
const TERRAINS = [["Urban", "Urban"], ["Forest", "Forest"], ["Mountain", "Mountain"]];

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function row(k, v) { return (v && v !== "NaN") ? `<div class="op-row"><span class="k">${esc(k)}</span><span class="v"> ${esc(v)}</span></div>` : ""; }

function clearDetails() {
    selectedId = null;
    d3.select("#details-panel").html('<p class="details-empty">Click a point on the map.</p>');
    if (mapGroup) highlightSelected();
}

function toggleAdvancedDetails(d) {
    const coords = `${(+d.Latitude_Clean).toFixed(3)}, ${(+d.Longitude_Clean).toFixed(3)}`;
    const dates = (d.Start && d.End) ? `${d.Start} → ${d.End}` : (d.Start || "");
    const modTags = MODALITIES.filter(([col]) => String(d[col]).trim() === "1").map(([, lbl]) => `<span class="op-tag">${esc(lbl)}</span>`).join("");
    const terrTags = TERRAINS.filter(([col]) => String(d[col]).trim() === "1").map(([, lbl]) => `<span class="op-tag terrain">${esc(lbl)}</span>`).join("");
    if (showingAdvancedDetailsView) {
        // d3.select("#map-area").style("display", "block")
        // d3.select("#adv-details-area").style("display", "none")
        d3.select("#advanced-button").text("Hide Advanced Analysis")
        d3.select("#details-panel").html(`
        <div class="op-name">${esc(d.Operation)}</div>
        <div class="op-parent">${d.Parent && d.Parent !== d.Operation ? "Part of " + esc(d.Parent) : "Standalone operation"}</div>
        <button id="advanced-button" class="op-advanced">Advanced Analysis Available</button>
    `);
        d3.select("#advanced-button").text("Show More Details")
    } else {
        // ${row("Civilian cas.", d["Civilian casualties"])}${row("US cas.", d["US casualties"])}
        d3.select("#advanced-button").text("Hide Advanced Analysis")
        d3.select("#details-panel").html(`
            
        <div class="op-name">${esc(d.Operation)}</div>
        <div class="op-parent">${d.Parent && d.Parent !== d.Operation ? "Part of " + esc(d.Parent) : "Standalone operation"}</div>
         <button id="advanced-button" class="op-advanced">Hide Details</button>
        <div class="op-rows">
            ${row("Year", d.Year)}${row("Dates", dates)}${row("Duration", d["Duration (days)"] ? d["Duration (days)"] + " days" : "")}
            ${row("Coordinates", coords)}
        </div>
       
        <div id="env-holder"><span class="k spec-font">Environment</span>${modTags + terrTags ? `<div class="op-tags">${modTags}${terrTags}</div>` : ""}</div>
        <div><span class="spec-font">Casualties</span></div>
         <div class="adv-chart" id="casualties-chart"></div>
          <div><span class="spec-font">Actors and Targets</span></div>
          <div class="adv-chart" id="actors-plot">
          </div>
    `);
        renderCasualtiesBarChart();
        renderActorsBars();
    }

    d3.select("#advanced-button").on("click", function () {
        console.log("hello")
        toggleAdvancedDetails(d)
        // d3.select("#adv-details-area").style("display", "flex")
        // d3.select("#general-info").html(`
        //     <div class="op-row"><span class="k">Combat Environment</span></div>
        //     ${modTags + terrTags ? `<div class="op-tags">${modTags}${terrTags}</div>` : ""}
        //     ${row("Coordinates", coords)}${row("Civilian cas.", d["Civilian casualties"])}${row("US cas.", d["US casualties"])}
        //     `)
        // renderCasualtiesBarChart();

    }
    );


    showingAdvancedDetailsView = !showingAdvancedDetailsView
}

function showOperationDetails(d) {
    const coords = `${(+d.Latitude_Clean).toFixed(3)}, ${(+d.Longitude_Clean).toFixed(3)}`;
    const dates = (d.Start && d.End) ? `${d.Start} → ${d.End}` : (d.Start || "");
    const modTags = MODALITIES.filter(([col]) => String(d[col]).trim() === "1").map(([, lbl]) => `<span class="op-tag">${esc(lbl)}</span>`).join("");
    const terrTags = TERRAINS.filter(([col]) => String(d[col]).trim() === "1").map(([, lbl]) => `<span class="op-tag terrain">${esc(lbl)}</span>`).join("");

    d3.select("#details-panel").html(`
        <div class="op-name">${esc(d.Operation)}</div>
        <div class="op-parent">${d.Parent && d.Parent !== d.Operation ? "Part of " + esc(d.Parent) : "Standalone operation"}</div>
                <button id="advanced-button" class="op-advanced">Show More Details</button>
    `);
    
    if (showingAdvancedDetailsView) {
        toggleAdvancedDetails(d)
        toggleAdvancedDetails(d)
    }

    d3.select("#advanced-button").on("click", function () {
        console.log("hello")
        toggleAdvancedDetails(d)
        // d3.select("#adv-details-area").style("display", "flex")
        // d3.select("#general-info").html(`
        //     <div class="op-row"><span class="k">Combat Environment</span></div>
        //     ${modTags + terrTags ? `<div class="op-tags">${modTags}${terrTags}</div>` : ""}
        //     ${row("Coordinates", coords)}${row("Civilian cas.", d["Civilian casualties"])}${row("US cas.", d["US casualties"])}
        //     `)
        // renderCasualtiesBarChart();

    }
    );




}

function drawMap({ svg, path, outline, graticule, land, borders, countries, locations, projection, rivers, lakes, urban, cities }) {
    mapGroup = svg.append("g").attr("class", "map-group");

    const isMac = /mac/i.test(navigator.platform);
    const zoom = d3.zoom()
        .scaleExtent([1, 50])
        .filter(function () {
            // Wheel only zooms with Cmd (Mac) or Ctrl (Win/Linux); plain scroll scrolls the page
            // if (d3.event.type === "wheel") return isMac ? d3.event.metaKey : d3.event.ctrlKey;
            if (d3.event.type === "wheel") return d3.event.shiftKey;
            return !d3.event.button;
        })
        .on("zoom", function () {
            zoomLevel = d3.event.transform.k;
            mapGroup.attr("transform", d3.event.transform);
            mapGroup.selectAll(".country-label").attr("font-size", d => Math.sqrt(path.area(d)) / 10);
            mapGroup.selectAll(".city").style("display", d3.event.transform.k > 15 ? "block" : "none");
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

    cityGroups.append("circle").attr("r", 0.25).attr("fill", "gray");
    cityGroups.append("text").attr("y", 0.5).attr("font-size", "0.25px").attr("text-anchor", "middle").text(d => d.city_name);

    updateOperationsPoints(locations);
}

function drawSizeLegend() {
    const sizeSvg = d3.select("#legend-size");
    const ticks = [
        Math.max(1, Math.round(maxTotalCasualties * 0.01)),
        Math.round(maxTotalCasualties * 0.1),
        maxTotalCasualties
    ];
    const baseline = 38;
    let cx = 8;
    ticks.forEach(val => {
        const r = casualtySizeScale(val);
        sizeSvg.append("circle")
            .attr("cx", cx + r)
            .attr("cy", baseline - r)
            .attr("r", r)
            .attr("fill", "none")
            .attr("stroke", "#5c5b4e")
            .attr("stroke-width", 0.5);
        sizeSvg.append("text")
            .attr("x", cx + r)
            .attr("y", baseline + 9)
            .attr("text-anchor", "middle")
            .attr("font-size", "9px")
            .attr("fill", "#5c5b4e")
            .text(val >= 1000 ? `${Math.round(val / 1000)}k` : val);
        cx += r * 2 + 8;
    });
}

function renderModalityTable() {
    const operation = dataPoints.find(d => d.ID === selectedId)

    const modalities = [
        "Drones",
        "Air to air",
        "Cruise missiles",
        "Aerial bombing",
        "Close air support",
        "Ground troops",
        "Paramil"
    ];

    d3.select("#modality-table").remove();

    const table = d3.select("#modalities-table")
        .append("table")
        .attr("id", "modality-table");

    const rows = table.selectAll("tr")
        .data(modalities)
        .enter()
        .append("tr");

    rows.append("td")
        .text(d => d);

    rows.append("td")
        .text(d => operation[d] == 1 ? "Used" : "Unused");
}

function renderCasualtiesBarChart() {
    const operation = dataPoints.find(d => d.ID === selectedId)
    d3.select("#casualty-breakdown").remove();

    const data = [
        // { label: "Side A", value: +operation["US + Allies casualties"] || 0 },
        // { label: "Side B", value: +operation["Opposing Forces casualties"] || 0 },
        { label: "Civilian", value: +operation["Civilian casualties"] || 0, color: "red" },
        { label: "US", value: +operation["US casualties"] || 0, color: "blue" }
    ];

    const width = 300;
    const height = 60;
    const margin = { top: 10, right: 40, bottom: 10, left: 80 };

    const svg = d3.select("#casualties-chart")
        .append("svg")
        .attr("id", "casualty-breakdown")
        .attr("width", width)
        .attr("height", height);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear()
        .domain([0, d3.max(data, d => d.value) || 1])
        .range([0, innerWidth]);

    const y = d3.scaleBand()
        .domain(data.map(d => d.label))
        .range([0, innerHeight])
        .padding(0.2);

    g.selectAll("rect")
        .data(data)
        .enter()
        .append("rect")
        .attr("x", 0)
        .attr("y", d => y(d.label))
        .attr("width", d => x(d.value))
        .attr("height", y.bandwidth())
        .attr("fill", d => d.color);

    g.selectAll(".label")
        .data(data)
        .enter()
        .append("text")
        .attr("class", "label")
        .attr("x", -8)
        .attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("text-anchor", "end")
        .attr("font-family", " JetBrains Mono", "monospace")
        .attr("font-size", "12px")
        .attr("dominant-baseline", "middle")
        .text(d => d.label);

    g.selectAll(".value")
        .data(data)
        .enter()
        .append("text")
        .attr("class", "value")
        .attr("x", d => x(d.value) + 5)
        .attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("dominant-baseline", "middle")
        .text(d => d.value);

}

function renderActorsBars() {

    const operation = dataPoints.find(d => d.ID === selectedId)
    d3.select("#actor-bars").remove();

    const data = [
        { label: "US Allies", value: +operation["US allies"] || 0, color: "green" },
        { label: "State", value: +operation["State targets"] || 0, color: "red" },
        { label: "Non-State", value: +operation["Non-state targets"] || 0, color: "darkgray" }
    ];

    const total = d3.sum(data, d => d.value);
    if (total === 0) return;

    const width = 400;
    const barWidth = 300;
    const height = 30;

    const svg = d3.select("#actors-plot")
        .append("svg")
        .attr("id", "actor-bars")
        .attr("width", width)
        .attr("height", height);



    let x = 0;
    data.forEach(d => {
        const segmentWidth = barWidth * (d.value / total);

        svg.append("rect")
            .attr("x", x)
            .attr("y", 10)
            .attr("width", segmentWidth)
            .attr("height", 20)
            .attr("fill", d.color);



        x += segmentWidth;
    });

    svg.append("text")
        .attr("x", barWidth + 5)
        .attr("y", height * 0.75)
        .text("Total: " + total)
        .attr("font-family", "JetBrains Mono")
        .attr("font-size", "9px");


    d3.select("#actors-plot").append().html(`
        <div id="actors-legend">
        <div class="actors-color-label green"><div class="actors-rect"></div>US Allies</div>
        <div class="actors-color-label red"><div class="actors-rect"></div>State Targets</div>
        <div class="actors-color-label darkgray"><div class="actors-rect"></div>Non-State Targets</div>
    </div>
        `)
}
