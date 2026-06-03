const svg = d3.select("#map-svg");

const width = window.innerWidth;
const height = window.innerHeight;

svg.attr("viewBox", `0 0 ${width} ${height}`);

let year = -1
let mapGroup
let projection
let dataPoints
let zoomLevel = 1
let casualtyMode = false
let maxTotalCasualties = 1
const casualtySizeScale = d3.scaleSqrt().range([5, 25])
const civilianRatioColorScale = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 1])

d3.select("#year-slider").on("input", function () {
    year = event.target.value
    d3.select("#year-label").text(year);
    updateOperationsPoints(dataPoints.filter(d => d["Year"] == year))
});
d3.select("#year-show-all-button").on("click", function () {
    if (year != - 1) {
        year = -1;
        d3.select("#year-label").text("All years");
        d3.select("#year-slider-container").style("display", "none");
        d3.select("#year-show-all-button").text("Filter by year")
        updateOperationsPoints(dataPoints)
    } else {
        year = 1989
        d3.select("#year-label").text("1989");
        d3.select("#year-slider-container").style("display", "flex");
        d3.select("#year-show-all-button").text("Show all years")
        updateOperationsPoints(dataPoints.filter(d => d["Year"] == year))
    }
});

d3.select("#casualty-toggle").on("click", function () {
    casualtyMode = !casualtyMode
    d3.select(this).classed("active", casualtyMode)
    d3.select("#casualty-legend").style("display", casualtyMode ? "block" : "none")
    updateOperationsPoints(year === -1 ? dataPoints : dataPoints.filter(d => d["Year"] == year))
})



Promise.all([
    d3.json("countries-50m.json"),
    d3.csv("Military_Operations_Strategic_cleaned_coordinates.csv"),
    d3.json("rivers.geojson"),
    d3.json("lakes.geojson"),
    d3.json("urban_areas.csv"),
    d3.json("ne_50m_populated_places.geojson")
]).then(([world, locations, rivers, lakes, urban, populated]) => {
    const outline = { type: "Sphere" };

    dataPoints = locations

    maxTotalCasualties = d3.max(locations, d => (+d["Side A casualties"] || 0) + (+d["Side B casualties"] || 0) + (+d["Civilian casualties"] || 0)) || 1
    casualtySizeScale.domain([0, maxTotalCasualties])
    drawSizeLegend()

    projection = d3.geoEqualEarth();
    projection.fitSize([width, height], outline);

    const path = d3.geoPath(projection);

    const graticule = d3.geoGraticule10();
    const land = topojson.feature(world, world.objects.land);
    const borders = topojson.mesh(
        world,
        world.objects.countries,
        (a, b) => a !== b
    );
    const countries = topojson.feature(world, world.objects.countries);

    drawMap({
        svg,
        path,
        outline,
        graticule,
        land,
        borders,
        countries,
        locations,
        projection,
        rivers,
        lakes,
        urban,
        populated
    })
});

function parseCasualties(d) {
    const sideA = +d["Side A casualties"] || 0
    const sideB = +d["Side B casualties"] || 0
    const civilian = +d["Civilian casualties"] || 0
    const us = +d["US casualties"] || 0
    const hasData = d["Side A casualties"] !== "" || d["Side B casualties"] !== "" || d["Civilian casualties"] !== "" || d["US casualties"] !== ""
    const total = sideA + sideB + civilian
    const ratio = total > 0 ? civilian / total : 0
    return { sideA, sideB, civilian, us, total, ratio, hasData }
}

function getCasualtyFill(d) {
    const { hasData, ratio } = parseCasualties(d)
    return hasData ? civilianRatioColorScale(ratio) : "#999"
}

function updateOperationsPoints(newOperations) {
    const points = mapGroup.selectAll(".operation-point")
        .data(newOperations)

    points.exit().remove()

    const merged = points.enter()
        .append("circle")
        .attr("class", "operation-point")
        .attr("stroke", "black")
        .merge(points)

    merged
        .attr("cx", d => projection([+d.Longitude_Clean, +d.Latitude_Clean])[0])
        .attr("cy", d => projection([+d.Longitude_Clean, +d.Latitude_Clean])[1])
        .attr("r", d => casualtyMode ? casualtySizeScale(parseCasualties(d).total) / zoomLevel : 5 / zoomLevel)
        .attr("fill", d => casualtyMode ? getCasualtyFill(d) : "red")
        .attr("stroke-width", 0.5 / zoomLevel)
        .attr("opacity", casualtyMode ? 0.8 : 1)

    merged.selectAll("title").remove()
    merged.append("title")
        .text(d => {
            const { sideA, sideB, civilian, us } = parseCasualties(d)
            return casualtyMode
                ? `${d.Operation}\n${d.Parent}\n${d.Year}\nSide A: ${sideA}  Side B: ${sideB}\nCivilian: ${civilian}  US: ${us}`
                : `${d.Operation}\n${d.Parent}\n${d.Year}\nLatitude: ${d.Latitude_Clean}\nLongitude: ${d.Longitude_Clean}`
        })
}

function drawMap({
    svg,
    path,
    outline,
    graticule,
    land,
    borders,
    countries,
    locations,
    projection,
    rivers,
    lakes,
    urban,
    populated
}) {
    mapGroup = svg.append("g")
        .attr("class", "map-group");

    const zoom = d3.zoom()
        .scaleExtent([1, 50])
        .on("zoom", function () {
            zoomLevel = d3.event.transform.k

            mapGroup.attr("transform", d3.event.transform);

            console.log(d3.event.transform)

            mapGroup.selectAll(".country-label")
                // .style("display", d3.event.transform.k >= 2 ? "block" : "none")
                .attr("font-size", d => Math.sqrt(path.area(d)) / 10);
            mapGroup.selectAll(".operation-point")
                .attr("r", d => casualtyMode ? casualtySizeScale(parseCasualties(d).total) / zoomLevel : 5 / zoomLevel)
                .attr("stroke-width", 0.5 / zoomLevel)


            if (d3.event.transform.k > 6) {
                mapGroup.selectAll(".city")
                    .style("display", "block")
                // mapGroup.selectAll(".city text")

                //     .attr("font-size", 10 / d3.event.transform.k + "px");

                // mapGroup.selectAll(".city circle")

                //     .attr("r", 5 / d3.event.transform.k);
            } else {
                mapGroup.selectAll(".city")
                    .style("display", "none")
            }

        });

    svg.call(zoom);

    mapGroup.append("path")
        .datum(outline)
        .attr("d", path)
        .attr("fill", "#9ecae1")
        ;

    mapGroup.append("path")
        .datum(graticule)
        .attr("d", path)
        .attr("stroke", "#ccc")
        .attr("fill", "none");

    mapGroup.append("path")
        .datum(land)
        .attr("d", path)
        .attr("fill", "#d8c59a");

    mapGroup.append("path")
        .datum(borders)
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#000")
        .attr("stroke-width", "0.25px")
        .attr("opacity", "0.5");

    mapGroup.append("path")
        .datum(outline)
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#000");



    mapGroup.selectAll(".river")
        .data(rivers.features)
        .enter()
        .append("path")
        .attr("class", "river")
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#4292c6")
        .attr("stroke-width", 0.25);

    mapGroup.selectAll(".lake")
        .data(lakes.features)
        .enter()
        .append("path")
        .attr("class", "lake")
        .attr("d", path)
        .attr("fill", "#4292c6")
        .attr("stroke", "#4292c6")
        .attr("stroke-width", 0.25);

    mapGroup.selectAll(".urban")
        .data(urban.features)
        .enter()
        .append("path")
        .attr("class", "urban")
        .attr("d", path)
        .attr("fill", "orange")
        .attr("stroke", "orange")
        .attr("stroke-width", 0.25);

    mapGroup.selectAll(".country-label")
        .data(countries.features.filter(d => path.area(d) > 70))
        .enter()
        .append("text")
        .attr("class", "country-label")
        .attr("x", d => path.centroid(d)[0])
        .attr("y", d => path.centroid(d)[1])
        .attr("font-size", d => Math.sqrt(path.area(d)) / 10)
        .attr("text-anchor", "middle")
        .attr("fill", "blue")
        .attr("pointer-events", "none")
        .style("display", "block")
        .text(d => d.properties.name || d.id);

    const populatedGroups = mapGroup.selectAll(".city")
        .data(populated.features)
        .enter()
        .append("g")
        .style("display", "none")
        .attr("class", "city")
        .attr("transform", d => {
            const [x, y] = projection(d.geometry.coordinates);
            return `translate(${x},${y})`;
        });

    populatedGroups.append("circle")
        .attr("r", 0.5)
        .attr("fill", "gray");

    populatedGroups.append("text")
        .attr("y", 2)
        .attr("font-size", "1px")
        .attr("text-anchor", "middle")
        .text(d => d.properties.NAME);

    //     mapGroup.selectAll(".operation-point")
    //         .data(locations)
    //         .enter()
    //         .append("circle")
    //         .attr("class", "operation-point")
    //         .attr("cx", d => projection([+d.Longitude_Clean, +d.Latitude_Clean])[0])
    //         .attr("cy", d => projection([+d.Longitude_Clean, +d.Latitude_Clean])[1])
    //         .attr("r", 3)
    //         .attr("fill", "red")
    //         .attr("stroke", "black")
    //         .attr("stroke-width", 0.5)
    //         .append("title")
    //         .text(d =>
    //             `${d.Operation}
    // ${d.Parent}
    // ${d.Year}
    // Latitude: ${d.Latitude_Clean}
    // Longitude: ${d.Longitude_Clean}`
    //         );
    updateOperationsPoints(locations)
}

function drawSizeLegend() {
    const sizeSvg = d3.select("#legend-size")
    const ticks = [
        Math.max(1, Math.round(maxTotalCasualties * 0.01)),
        Math.round(maxTotalCasualties * 0.1),
        maxTotalCasualties
    ]
    const baseline = 40
    let cx = 8
    ticks.forEach(val => {
        const r = casualtySizeScale(val)
        sizeSvg.append("circle")
            .attr("cx", cx + r)
            .attr("cy", baseline - r)
            .attr("r", r)
            .attr("fill", "none")
            .attr("stroke", "#555")
            .attr("stroke-width", 0.5)
        sizeSvg.append("text")
            .attr("x", cx + r)
            .attr("y", baseline + 10)
            .attr("text-anchor", "middle")
            .attr("font-size", "9px")
            .attr("fill", "#555")
            .text(val >= 1000 ? `${Math.round(val / 1000)}k` : val)
        cx += r * 2 + 10
    })
}
