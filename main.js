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
let multiSelectOn = false;
let multiSelectedPoints = []
const casualtySizeScale = d3.scaleSqrt().range([5, 25]);
const civilianRatioColorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 1]);
let showingAdvancedDetailsView = false

let selectedOpA = null;
let selectedOpB = null;

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
    d3.select(this).style("background-color", casualtyMode ? "green" : "red")
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
    selectedOpA = null;
    selectedOpB = null;

    multiSelectOn = !multiSelectOn
    d3.select("#multi-select-btn").text("MULT_SELECT MODE").style("background-color", "red");
    multiSelectedPoints = []
    d3.select("#multi-plots").style("display", "none");
    d3.select("#deepdive-sidebar").style("display", "block");

    d3.select("#year-label").text("1989–2021");
    d3.select("#year-slider-container").style("display", "none");
    d3.select("#year-show-all-button").text("Filter by year");
    d3.select("#year-slider").property("value", 2021);
    d3.select("#terrain-filter").property("value", "all");
    d3.select("#modality-filter").property("value", "all");
    clearDetails();
    updateOperationsPoints();
    renderComparisonCharts();
});

Promise.all([
    d3.json("countries-50m.json"),
    d3.csv("Military_Operations_Strategic_cleaned_version_2.csv"),
    d3.json("rivers.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    d3.json("lakes.geojson").catch(() => ({ type: "FeatureCollection", features: [] })),
    d3.json("urban_areas.csv").catch((e) => { console.log('urbanerror', e) }),
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

            if (multiSelectOn) {
                if (multiSelectedPoints.some(e => e.ID == d.ID)) {
                    multiSelectedPoints = multiSelectedPoints.filter(e => e.ID != d.ID);
                } else {
                    multiSelectedPoints = [...multiSelectedPoints, d];
                }
                console.log(multiSelectedPoints)
                multiSelectHighlightSelected();
                renderMultiSelectPlots(multiSelectedPoints);
                return;
            }

            selectedId = d.ID;

            if (!selectedOpA || selectedOpA.ID === d.ID) {
                selectedOpA = d;
            } else {
                selectedOpB = selectedOpA;
                selectedOpA = d;
            }

            showOperationDetails(d);
            highlightSelected();
            renderComparisonCharts();
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

function multiSelectHighlightSelected() {
    if (!mapGroup) return;
    mapGroup.selectAll(".operation-point")
        .attr("fill", d => multiSelectedPoints.some(e => e.ID == d.ID) ? "green" : (casualtyMode ? getCasualtyFill(d) : "red"))
        .attr("r", d => {
            if (casualtyMode) {
                const base = casualtySizeScale(parseCasualties(d).total);
                return (d.ID === selectedId ? base * 1.4 : base) / zoomLevel;
            }
            return (multiSelectedPoints.some(e => e.ID == d.ID) ? 7 : 5) / zoomLevel
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
        d3.select("#adv-details-area").style("display", "none");
    } else {
        d3.select("#adv-details-area").style("display", "block");
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
            if (multiSelectOn) {
                multiSelectHighlightSelected();
                return
            }
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

    // cityGroups.append("circle").attr("r", 0.25).attr("fill", "gray");
    cityGroups
        .append("text")
        // .attr("y", 0.5)
        .attr("font-size", "0.25px").attr("text-anchor", "middle").text(d => d.city_name);

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

function renderActorsBarsPrevious() {
    const operation = dataPoints.find(d => d.ID === selectedOpB.ID)
    d3.select("#actor-bars-b").remove();
    d3.select("#actors-chart-b").html("");

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

    const svg = d3.select("#actors-chart-b")
        .append("svg")
        .attr("id", "actor-bars-b")
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


    d3.select("#actors-chart-b").append().html(`
        <div id="actors-legend-b">
        <div class="actors-color-label green"><div class="actors-rect"></div>US Allies</div>
        <div class="actors-color-label red"><div class="actors-rect"></div>State Targets</div>
        <div class="actors-color-label darkgray"><div class="actors-rect"></div>Non-State Targets</div>
    </div>
        `)
}

function renderComparisonCharts() {
    d3.select("#casualties-chart-a").selectAll("*").remove();
    d3.select("#casualties-chart-b").selectAll("*").remove();

    if (!selectedOpA) {
        d3.select("#comp-title-a").text("[Click a point for Operation A]");
        return;
    }

    d3.select("#comp-title-a").text(`A: ${selectedOpA.Operation} (${selectedOpA.Year})`);
    renderSingleCompBar("#casualties-chart-a", selectedOpA);

    if (!selectedOpB) {
        d3.select("#comp-title-b").text("[No Previous Selected Operation]");
        return;
    }

    d3.select("#comp-title-b").text(`${selectedOpB.Operation} (${selectedOpB.Year})`);
    renderSingleCompBar("#casualties-chart-b", selectedOpB);
    renderActorsBarsPrevious();


}

function renderSingleCompBar(containerId, operation) {
    const data = [
        { label: "Civilian", value: +operation["Civilian casualties"] || 0, color: "#b4231c" },
        { label: "US", value: +operation["US casualties"] || 0, color: "#4292c6" }
    ];

    const width = 280;
    const height = 60;
    const margin = { top: 5, right: 40, bottom: 5, left: 60 };

    const svg = d3.select(containerId)
        .append("svg")
        .attr("width", width)
        .attr("height", height);

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const maxVal = Math.max(
        d3.max([selectedOpA, selectedOpB].filter(Boolean), d => Math.max(+d["Civilian casualties"] || 0, +d["US casualties"] || 0)) || 1
    );

    const x = d3.scaleLinear()
        .domain([0, maxVal])
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
        .attr("x", -8)
        .attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("text-anchor", "end")
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("font-size", "10px")
        .attr("dominant-baseline", "middle")
        .text(d => d.label);

    g.selectAll(".value")
        .data(data)
        .enter()
        .append("text")
        .attr("x", d => x(d.value) + 5)
        .attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("font-size", "10px")
        .attr("dominant-baseline", "middle")
        .text(d => d.value);
}

// Some macro trend charts
let isTrendsRevealed = false;

d3.select("#toggle-trends-btn").on("click", function () {
    isTrendsRevealed = !isTrendsRevealed;
    const dashboard = d3.select("#macro-trends-dashboard");

    if (isTrendsRevealed) {
        dashboard.classed("hidden-dashboard", false);
        d3.select(this).text("Hide Macro Trends");
        d3.select("#map-area").style("display", "none");
        d3.select("#control-strip").style("display", "none");
        d3.select("#adv-details-area").style("display", "none");

        if (dataPoints && dataPoints.length > 0) {
            renderAggregateTrends(dataPoints);
        }
        document.getElementById("macro-trends-dashboard").scrollIntoView({ behavior: "smooth" });
    } else {
        dashboard.classed("hidden-dashboard", true);
        d3.select(this).text("Reveal Macro Trends");
        d3.select("#adv-details-area").style("display", "block");
        d3.select("#control-strip").style("display", "flex");
        d3.select("#map-area").style("display", "block");
    }
});

function renderAggregateTrends(data) {
    d3.select("#trend-tech-chart").selectAll("*").remove();
    d3.select("#trend-targets-chart").selectAll("*").remove();
    d3.select("#trend-casualty-chart").selectAll("*").remove();

    const chartCard = document.querySelector(".chart-card");
    if (!chartCard) return;

    const margin = { top: 20, right: 30, bottom: 30, left: 40 },
        width = chartCard.clientWidth - margin.left - margin.right,
        height = 250 - margin.top - margin.bottom;

    const nestedData = d3.nest()
        .key(d => d.Year)
        .entries(data);

    const aggregatedData = nestedData.map(d => {
        const v = d.values;
        const totalOps = v.length;
        const stateOps = d3.sum(v, op => op["State targets"] == "1" ? 1 : 0);
        const nonStateOps = d3.sum(v, op => op["Non-state targets"] == "1" ? 1 : 0);
        const drones = d3.sum(v, op => op["Drones"] == "1" ? 1 : 0);
        const ground = d3.sum(v, op => op["Ground troops"] == "1" ? 1 : 0);

        const civCas = d3.sum(v, op => +op["Civilian casualties"] || 0);
        const totalCas = d3.sum(v, op => (+op["Side A casualties"] || 0) + (+op["Side B casualties"] || 0) + (+op["Civilian casualties"] || 0) + (+op["US casualties"] || 0));
        const civRatio = totalCas > 0 ? civCas / totalCas : 0;

        return { year: +d.key, totalOps, stateOps, nonStateOps, drones, ground, civRatio };
    }).filter(d => !isNaN(d.year)).sort((a, b) => d3.ascending(a.year, b.year));

    // Chart 1: Technological Shifts
    const svgTech = d3.select("#trend-tech-chart")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain(d3.extent(aggregatedData, d => d.year)).range([0, width]);
    svgTech.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickFormat(d3.format("d")));

    const yTech = d3.scaleLinear().domain([0, d3.max(aggregatedData, d => Math.max(d.drones, d.ground))]).range([height, 0]);
    svgTech.append("g").call(d3.axisLeft(yTech));

    svgTech.append("path")
        .datum(aggregatedData)
        .attr("fill", "none")
        .attr("stroke", "#4292c6")
        .attr("stroke-width", 2)
        .attr("d", d3.line().x(d => x(d.year)).y(d => yTech(d.drones)));

    svgTech.append("path")
        .datum(aggregatedData)
        .attr("fill", "none")
        .attr("stroke", "#d8c59a")
        .attr("stroke-width", 2)
        .attr("d", d3.line().x(d => x(d.year)).y(d => yTech(d.ground)));

    svgTech.append("line")
        .attr("x1", 10)
        .attr("x2", 28)
        .attr("y1", 10)
        .attr("y2", 10)
        .attr("stroke", "#4292c6")
        .attr("stroke-width", 2);

    svgTech.append("text")
        .attr("x", 34)
        .attr("y", 14)
        .attr("fill", "white")
        .attr("font-size", "12px")
        .text("Drones");

    svgTech.append("line")
        .attr("x1", 10)
        .attr("x2", 28)
        .attr("y1", 28)
        .attr("y2", 28)
        .attr("stroke", "#d8c59a")
        .attr("stroke-width", 2);

    svgTech.append("text")
        .attr("x", 34)
        .attr("y", 32)
        .attr("fill", "white")
        .attr("font-size", "12px")
        .text("Ground troops");


    // Chart 2: Target Shifts
    const svgTargets = d3.select("#trend-targets-chart")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    svgTargets.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickFormat(d3.format("d")));
    const yTargets = d3.scaleLinear().domain([0, d3.max(aggregatedData, d => Math.max(d.stateOps, d.nonStateOps))]).range([height, 0]);
    svgTargets.append("g").call(d3.axisLeft(yTargets));

    svgTargets.append("path")
        .datum(aggregatedData)
        .attr("fill", "none")
        .attr("stroke", "#b4231c")
        .attr("stroke-width", 2)
        .attr("d", d3.line().x(d => x(d.year)).y(d => yTargets(d.stateOps)));

    svgTargets.append("path")
        .datum(aggregatedData)
        .attr("fill", "none")
        .attr("stroke", "#888888")
        .attr("stroke-width", 2)
        .attr("d", d3.line().x(d => x(d.year)).y(d => yTargets(d.nonStateOps)));

    svgTargets.append("line")
        .attr("x1", x(2001)).attr("y1", 0)
        .attr("x2", x(2001)).attr("y2", height)
        .style("stroke-dasharray", "3, 3")
        .style("stroke", "white");

    svgTargets.append("line")
        .attr("x1", 10)
        .attr("x2", 28)
        .attr("y1", 10)
        .attr("y2", 10)
        .attr("stroke", "#b4231c")
        .attr("stroke-width", 2);

    svgTargets.append("text")
        .attr("x", 34)
        .attr("y", 14)
        .attr("fill", "white")
        .attr("font-size", "12px")
        .text("State Targets");

    svgTargets.append("line")
        .attr("x1", 10)
        .attr("x2", 28)
        .attr("y1", 28)
        .attr("y2", 28)
        .attr("stroke", "#888888")
        .attr("stroke-width", 2);

    svgTargets.append("text")
        .attr("x", 34)
        .attr("y", 32)
        .attr("fill", "white")
        .attr("font-size", "12px")
        .text("Non-State Targets");


    // Chart 3: Human Cost
    const svgCas = d3.select("#trend-casualty-chart")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    svgCas.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).tickFormat(d3.format("d")));

    const yCasLeft = d3.scaleLinear().domain([0, d3.max(aggregatedData, d => d.drones)]).range([height, 0]);
    svgCas.append("g").call(d3.axisLeft(yCasLeft));

    const yCasRight = d3.scaleLinear().domain([0, 1]).range([height, 0]);
    svgCas.append("g").attr("transform", `translate(${width},0)`).call(d3.axisRight(yCasRight).tickFormat(d3.format(".0%")));

    svgCas.selectAll("rect")
        .data(aggregatedData)
        .enter()
        .append("rect")
        .attr("x", d => x(d.year) - 4)
        .attr("y", d => yCasLeft(d.drones))
        .attr("width", 8)
        .attr("height", d => height - yCasLeft(d.drones))
        .attr("fill", "#4292c6")
        .attr("opacity", 0.5);

    svgCas.append("path")
        .datum(aggregatedData)
        .attr("fill", "none")
        .attr("stroke", "#ffaa00")
        .attr("stroke-width", 3)
        .attr("d", d3.line()
            .curve(d3.curveMonotoneX)
            .x(d => x(d.year))
            .y(d => yCasRight(d.civRatio))
        );

    svgCas.append("line")
        .attr("x1", 10)
        .attr("x2", 28)
        .attr("y1", 10)
        .attr("y2", 10)
        .attr("stroke", "#ffaa00")
        .attr("stroke-width", 2);

    svgCas.append("text")
        .attr("x", 34)
        .attr("y", 14)
        .attr("fill", "white")
        .attr("font-size", "12px")
        .text("Civilian Casualty Rate");

    svgCas.append("line")
        .attr("x1", 10)
        .attr("x2", 28)
        .attr("y1", 28)
        .attr("y2", 28)
        .attr("stroke", "#4292c6")
        .attr("stroke-width", 2);

    svgCas.append("text")
        .attr("x", 34)
        .attr("y", 32)
        .attr("fill", "white")
        .attr("font-size", "12px")
        .text("Drone Operations");



}

d3.select("#multi-select-btn").on("click", function () {
    multiSelectOn = !multiSelectOn;
    if (multiSelectOn) {
        d3.select("#multi-select-btn").text("MULT_SELECT MODE").style("background-color", "green");
        d3.select("#multi-plots").style("display", "flex");
        renderMultiSelectPlots(multiSelectedPoints);
        d3.select("#deepdive-sidebar").style("display", "none");
    } else {
        d3.select("#multi-select-btn").text("MULT_SELECT MODE").style("background-color", "red");
        multiSelectedPoints = []
        d3.select("#multi-plots").style("display", "none");
        d3.select("#deepdive-sidebar").style("display", "block");
        highlightSelected()
    }
});

function renderMultiSelectPlots(data) {

    d3.select("#operation-profile-comparison").selectAll("*").remove();

    if (!data || data.length === 0) return;

    const dimensions = [
        "Duration (days)",
        "Days into parent",
        "State targets",
        "Non-state targets",
        "US allies",
        "US casualties",
        "Side B casualties",
        "Civilian casualties"
    ];

    const margin = { top: 40, right: 0, bottom: 70, left: 0 };

    const width =
        d3.select("#multi-plots").node().clientWidth - 50


    const height = d3.select("#multi-plots").node().clientHeight

    const svg = d3.select("#operation-profile-comparison")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scalePoint()
        .domain(dimensions)
        .range([0, width])
        .padding(0.4);

    const yScales = {};

    dimensions.forEach(dim => {
        const maxVal = d3.max(data, d => +d[dim] || 0);

        yScales[dim] = d3.scaleLinear()
            .domain([0, maxVal || 1])
            .nice()
            .range([height, 0]);
    });

    const color = d3.scaleOrdinal(d3.schemeTableau10)
        .domain(data.map(d => d.Operation));

    function path(d) {
        return d3.line()(dimensions.map(dim => [
            x(dim),
            yScales[dim](+d[dim] || 0)
        ]));
    }

    g.selectAll(".operation-line")
        .data(data)
        .enter()
        .append("path")
        .attr("class", "operation-line")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", d => color(d.Operation))
        .attr("stroke-width", 2)
        .attr("opacity", 0.7);

    dimensions.forEach(dim => {
        const axis = g.append("g")
            .attr("transform", `translate(${x(dim)},0)`)
            .call(d3.axisLeft(yScales[dim]).ticks(4));

        axis.append("text")
            .attr("x", 0)
            .attr("y", height + 30)
            .attr("text-anchor", "middle")
            .attr("font-family", "JetBrains Mono")
            .attr("fill", "black")
            .attr("font-size", "10px")
            .attr("transform", `rotate(35, 0, ${height + 25})`)
            .text(dim);
    });

    svg.append("text")
        .attr("x", margin.left)
        .attr("y", 20)
        .attr("font-weight", "bold")
        .text("Select Operations Feature Profiles");
}