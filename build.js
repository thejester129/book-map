// Builds dist/index.html by inlining the world map and popular books data into the page template.
// Usage: node build.js
const fs = require("fs");
const path = require("path");

function build() {
  const tpl = fs.readFileSync(path.join(__dirname, "src/index.template.html"), "utf8");
  const topo = fs.readFileSync(path.join(__dirname, "src/countries-topo.json"), "utf8");
  const popular = fs.readFileSync(path.join(__dirname, "src/popular-books.json"), "utf8");
  fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "dist/index.html"), tpl.replace("__TOPO__", () => topo).replace("__POPULAR__", () => popular));
  console.log("Built dist/index.html");
}

if (require.main === module) build();
module.exports = build;
