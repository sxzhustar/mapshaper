/* @requires mapshaper-shape-utils, mapshaper-arc-classifier */

api.innerlines = function(lyr, arcs, opts) {
  opts = opts || {};
  internal.requirePolygonLayer(lyr);
  var filter = opts.where ? internal.compileFeaturePairFilterExpression(opts.where, lyr, arcs) : null;
  var classifier = internal.getArcClassifier(lyr.shapes, arcs, filter);
  var lines = internal.extractInnerLines(lyr.shapes, classifier);
  var outputLyr = internal.createLineLayer(lines, null);

  if (lines.length === 0) {
    message("No shared boundaries were found");
  }
  outputLyr.name = opts.no_replace ? null : lyr.name;
  return outputLyr;
};

api.lines = function(lyr, arcs, opts) {
  opts = opts || {};
  var filter = opts.where ? internal.compileFeaturePairFilterExpression(opts.where, lyr, arcs) : null,
      decorateRecord = opts.each ? internal.getLineRecordDecorator(opts.each, lyr, arcs) : null,
      classifier = internal.getArcClassifier(lyr.shapes, arcs, filter),
      fields = utils.isArray(opts.fields) ? opts.fields : [],
      rankId = 0,
      shapes = [],
      records = [],
      outputLyr;

  internal.requirePolygonLayer(lyr, "Command requires a polygon layer");
  if (fields.length > 0 && !lyr.data) {
    stop("Missing a data table");
  }

  addLines(internal.extractOuterLines(lyr.shapes, classifier), 'outer');

  fields.forEach(function(field) {
    var data = lyr.data.getRecords();
    var key = function(a, b) {
      var arec = data[a];
      var brec = data[b];
      var aval, bval;
      if (!arec || !brec || arec[field] === brec[field]) {
        return null;
      }
      return a + '-' + b;
    };
    if (!lyr.data.fieldExists(field)) {
      stop("Unknown data field:", field);
    }
    addLines(internal.extractLines(lyr.shapes, classifier(key)), field);
  });

  addLines(internal.extractInnerLines(lyr.shapes, classifier), 'inner');
  outputLyr = internal.createLineLayer(shapes, records);
  outputLyr.name = opts.no_replace ? null : lyr.name;
  return outputLyr;

  function addLines(lines, typeName) {
    var attr = lines.map(function(shp, i) {
      var rec = {RANK: rankId, TYPE: typeName};
      if (decorateRecord) decorateRecord(rec, shp);
      return rec;
    });
    shapes = utils.merge(lines, shapes);
    records = utils.merge(attr, records);
    rankId++;
  }
};

// kludgy way to implement each= option of -lines command
internal.getLineRecordDecorator = function(exp, lyr, arcs) {
  // repurpose arc classifier function to convert arc ids to shape ids of original polygons
  var procArcId = internal.getArcClassifier(lyr.shapes, arcs)(procShapeIds);
  var compiled = internal.compileFeaturePairExpression(exp, lyr, arcs);
  var tmp;

  function procShapeIds(shpA, shpB) {
    compiled(shpA, shpB, tmp);
  }

  return function(rec, shp) {
    tmp = rec;
    procArcId(shp[0][0]);
    return rec;
  };
};

internal.createLineLayer = function(lines, records) {
  return {
    geometry_type: 'polyline',
    shapes: lines,
    data: records ? new DataTable(records) : null
  };
};

internal.extractOuterLines = function(shapes, classifier) {
  var key = function(a, b) {return b == -1 ? String(a) : null;};
  return internal.extractLines(shapes, classifier(key));
};

internal.extractInnerLines = function(shapes, classifier) {
  var key = function(a, b) {return b > -1 ? a + '-' + b : null;};
  return internal.extractLines(shapes, classifier(key));
};

internal.extractLines = function(shapes, classify) {
  var lines = [],
      index = {},
      prev = null,
      prevKey = null,
      part;

  internal.traversePaths(shapes, onArc, onPart);

  function onArc(o) {
    var arcId = o.arcId,
        key = classify(arcId),
        isContinuation, line;
    if (!!key) {
      line = key in index ? index[key] : null;
      isContinuation = key == prevKey && o.shapeId == prev.shapeId && o.partId == prev.partId;
      if (!line) {
        line = [[arcId]]; // new shape
        index[key] = line;
        lines.push(line);
      } else if (isContinuation) {
        line[line.length-1].push(arcId); // extending prev part
      } else {
        line.push([arcId]); // new part
      }

      // if extracted line is split across endpoint of original polygon ring, then merge
      if (o.i == part.arcs.length - 1 &&  // this is last arc in ring
          line.length > 1 &&              // extracted line has more than one part
          line[0][0] == part.arcs[0]) {   // first arc of first extracted part is first arc in ring
        line[0] = line.pop().concat(line[0]);
      }
    }
    prev = o;
    prevKey = key;
  }

  function onPart(o) {
    part = o;
  }

  return lines;
};
