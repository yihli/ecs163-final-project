const svg = d3.select("#map-svg");

const width = window.innerWidth;
const height = window.innerHeight;

svg.attr("viewBox", `0 0 ${width} ${height}`);

let year = -1

d3.select("#year-slider").on("input", function () {
    const year = this.value;
    d3.select("#year-label").text(year);
});
d3.select("#year-show-all-button").on("click", function () {
    if (year != - 1) {
        year = -1;
        d3.select("#year-label").text("All years");
        d3.select("#year-slider").style("display", "none");
        d3.select("#year-show-all-button").text("Filter by year")
    } else {
        year = 1989
        d3.select("#year-label").text("1989");
        d3.select("#year-slider").style("display", "block");
        d3.select("#year-show-all-button").text("Show all years")
    }
});

Promise.all([
    d3.json("countries-50m.json"),
    d3.csv("Military_Operations_Strategic_cleaned_coordinates.csv")
]).then(([world, locations]) => {
    const outline = { type: "Sphere" };

    const projection = d3.geoEqualEarth();
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
        width,
        height,
        path,
        outline,
        graticule,
        land,
        borders,
        countries,
        locations,
        projection
    });
});

function drawMap({
    svg,
    path,
    outline,
    graticule,
    land,
    borders,
    countries,
    locations,
    projection
}) {
    const mapGroup = svg.append("g")
        .attr("class", "map-group");

    const zoom = d3.zoom()
        .scaleExtent([1, 8])
        .on("zoom", function () {
            mapGroup.attr("transform", d3.event.transform);
        });

    svg.call(zoom);

    mapGroup.append("path")
        .datum(outline)
        .attr("d", path)
        .attr("fill", "#9ecae1");

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
        .attr("stroke", "#000");

    mapGroup.append("path")
        .datum(outline)
        .attr("d", path)
        .attr("fill", "none")
        .attr("stroke", "#000");

    mapGroup.selectAll(".country-label")
        .data(countries.features.filter(d => path.area(d) > 70))
        .enter()
        .append("text")
        .attr("class", "country-label")
        .attr("x", d => path.centroid(d)[0])
        .attr("y", d => path.centroid(d)[1])
        .attr("font-size", 6)
        .attr("text-anchor", "middle")
        .attr("fill", "#333")
        .attr("pointer-events", "none")
        .text(d => d.properties.name || d.id);

    mapGroup.selectAll(".operation-point")
        .data(locations)
        .enter()
        .append("circle")
        .attr("class", "operation-point")
        .attr("cx", d => projection([+d.Longitude_Clean, +d.Latitude_Clean])[0])
        .attr("cy", d => projection([+d.Longitude_Clean, +d.Latitude_Clean])[1])
        .attr("r", 2)
        .attr("fill", "red")
        .attr("stroke", "black")
        .attr("stroke-width", 0.5)
        .append("title")
        .text(d =>
            `${d.Operation}
${d.Parent}
${d.Year}
Latitude: ${d.Latitude_Clean}
Longitude: ${d.Longitude_Clean}`
        );
}