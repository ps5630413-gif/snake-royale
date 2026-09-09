/* ==========================================================================
 * spatialHash.js - Uniform grid used for broad-phase collision queries.
 *
 * The arena holds hundreds of food dots and thousands of body joints;
 * testing every pair would be O(n^2). Bucketing everything into a grid
 * makes "what is near this point?" a handful of array reads.
 *
 * NOTE: query()/queryCircle() return a SHARED array that is overwritten by
 * the next call - copy it if you need to keep the result.
 * ========================================================================== */
(function (global) {
  'use strict';

  var SR = (global.SR = global.SR || {});

  /**
   * @param {number} cellSize grid cell size in world units
   * @param {number} width    world width
   * @param {number} height   world height
   */
  function SpatialHash(cellSize, width, height) {
    this.cellSize = cellSize;
    this.width = width;
    this.height = height;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.buckets = [];              // index -> array of items
    this._out = [];                 // shared query result
    this.count = 0;
  }

  SpatialHash.prototype._index = function (cx, cy) {
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  };

  SpatialHash.prototype._ensure = function (i) {
    var b = this.buckets[i];
    if (!b) { b = []; this.buckets[i] = b; }
    return b;
  };

  /** Drop every item but keep the allocated buckets (avoids GC churn). */
  SpatialHash.prototype.clear = function () {
    for (var i = 0; i < this.buckets.length; i++) {
      if (this.buckets[i]) this.buckets[i].length = 0;
    }
    this.count = 0;
  };

  /** Insert an object that exposes numeric `x` and `y`. */
  SpatialHash.prototype.insert = function (obj) {
    var i = this._index(Math.floor(obj.x / this.cellSize), Math.floor(obj.y / this.cellSize));
    this._ensure(i).push(obj);
    this.count++;
    obj._cell = i;
  };

  /** Remove a previously inserted object (uses the cached cell index). */
  SpatialHash.prototype.remove = function (obj) {
    var i = (typeof obj._cell === 'number') ? obj._cell
      : this._index(Math.floor(obj.x / this.cellSize), Math.floor(obj.y / this.cellSize));
    var bucket = this.buckets[i];
    if (!bucket) return false;
    var k = bucket.indexOf(obj);
    if (k >= 0) { bucket.splice(k, 1); this.count--; return true; }
    return false;
  };

  /**
   * Collect items whose cell overlaps the circle (x, y, radius).
   * @returns {Array} shared array (do not retain)
   */
  SpatialHash.prototype.queryCircle = function (x, y, radius) {
    var out = this._out;
    out.length = 0;
    var cs = this.cellSize;
    var cx0 = Math.floor((x - radius) / cs), cx1 = Math.floor((x + radius) / cs);
    var cy0 = Math.floor((y - radius) / cs), cy1 = Math.floor((y + radius) / cs);
    if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
    if (cx1 >= this.cols) cx1 = this.cols - 1;
    if (cy1 >= this.rows) cy1 = this.rows - 1;

    for (var cy = cy0; cy <= cy1; cy++) {
      var rowBase = cy * this.cols;
      for (var cx = cx0; cx <= cx1; cx++) {
        var bucket = this.buckets[rowBase + cx];
        if (!bucket) continue;
        for (var i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  };

  /** Collect items whose cell overlaps the AABB. */
  SpatialHash.prototype.queryRect = function (x0, y0, x1, y1) {
    var out = this._out;
    out.length = 0;
    var cs = this.cellSize;
    var cx0 = Math.floor(x0 / cs), cx1 = Math.floor(x1 / cs);
    var cy0 = Math.floor(y0 / cs), cy1 = Math.floor(y1 / cs);
    if (cx0 < 0) cx0 = 0; if (cy0 < 0) cy0 = 0;
    if (cx1 >= this.cols) cx1 = this.cols - 1;
    if (cy1 >= this.rows) cy1 = this.rows - 1;

    for (var cy = cy0; cy <= cy1; cy++) {
      var rowBase = cy * this.cols;
      for (var cx = cx0; cx <= cx1; cx++) {
        var bucket = this.buckets[rowBase + cx];
        if (!bucket) continue;
        for (var i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  };

  SR.SpatialHash = SpatialHash;

})(typeof window !== 'undefined' ? window : globalThis);
