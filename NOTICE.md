# Third-party notice

This app embeds a build of the **Stellarium Web Engine**
(https://github.com/Stellarium/stellarium-web-engine), licensed under the
**GNU AGPL v3.0** (see that project's `COPYING` file). The compiled artifacts
are committed under [public/engine/](public/engine/) because the toolchain
that produces them is not — see [docs/BUILD.md](docs/BUILD.md).

## Modified

This build is **not stock upstream** — it carries a small patch on top of
upstream commit
[`be43d64367672250607d1cf405e42af720b01f32`](https://github.com/Stellarium/stellarium-web-engine/commit/be43d64367672250607d1cf405e42af720b01f32)
(2026-05-09), to export a hover-picking function the stock JS API doesn't
expose (`core_get_obj_at` is otherwise click-only):

```diff
diff --git a/SConstruct b/SConstruct
index e1e48ffb..eb119492 100644
--- a/SConstruct
+++ b/SConstruct
@@ -178,4 +178,6 @@ env.Program(target='build/stellarium-web-engine', source=sources)
 
 # Ugly hack to run makeasset before each compilation
 from subprocess import call
-call('./tools/make-assets.py')
+# Windows can't exec a .py via its shebang ("%1 is not a valid Win32
+# application"), so invoke it through the current Python interpreter.
+call([sys.executable, './tools/make-assets.py'])
diff --git a/src/core.c b/src/core.c
index e5e3f0e6..2df2ec08 100644
--- a/src/core.c
+++ b/src/core.c
@@ -132,6 +132,7 @@ void core_get_proj(projection_t *proj)
     mat4_mul(mat, proj->mat, proj->mat);
 }
 
+EMSCRIPTEN_KEEPALIVE
 obj_t *core_get_obj_at(double x, double y, double max_dist)
 {
     double pos[2] = {x, y};
diff --git a/src/js/obj.js b/src/js/obj.js
index 6b02f499..d888c8bd 100644
--- a/src/js/obj.js
+++ b/src/js/obj.js
@@ -12,6 +12,8 @@ Module.afterInit(function() {
   var obj_call_json_str = Module.cwrap('obj_call_json_str',
     'number', ['number', 'string', 'string']);
   var core_search = Module.cwrap('core_search', 'number', ['string']);
+  var core_get_obj_at = Module.cwrap('core_get_obj_at', 'number',
+    ['number', 'number', 'number']);
   var obj_get_id = Module.cwrap('obj_get_id', 'string', ['number']);
   var module_add = Module.cwrap('module_add', null, ['number', 'number']);
   var module_remove = Module.cwrap('module_remove', null, ['number', 'number']);
@@ -344,6 +346,16 @@ Module.afterInit(function() {
     return obj ? new SweObj(obj) : null;
   };
 
+  // Return the object at a screen position (CSS pixels relative to the canvas),
+  // or null if none is within max_dist pixels. The returned obj is retained;
+  // release it with `Module._obj_release(obj.v)` when done to avoid leaks.
+  // Used for hover picking (the engine itself only picks on click).
+  Module['getObjAt'] = function(x, y, maxDist) {
+    if (maxDist === undefined) maxDist = 18;
+    var obj = core_get_obj_at(x, y, maxDist);
+    return obj ? new SweObj(obj) : null;
+  };
+
   Module['change'] = function(callback, context) {
     g_listeners.push({
       'obj': null,
```

The `SConstruct` change is build tooling only (lets the asset-packing step run
under Windows Python); it has no effect on the compiled output. The `core.c` /
`obj.js` changes are what add `stel.getObjAt(x, y, maxDist)`, consumed by
[src/engine/StellariumBridge.js](src/engine/StellariumBridge.js)'s `_wireHover`.

## Getting the full corresponding source

Under AGPL §13, since this app is reachable over a network, the complete
corresponding source for the exact engine build served here must be available
to users. That source is:

- **Upstream base**: [Stellarium/stellarium-web-engine @ be43d64](https://github.com/Stellarium/stellarium-web-engine/commit/be43d64367672250607d1cf405e42af720b01f32)
- **This patch**: the diff above (also reproducible from
  [docs/BUILD.md](docs/BUILD.md), which documents the exact build procedure)
- **Build procedure**: [docs/BUILD.md](docs/BUILD.md) documents the exact steps,
  including `build-direct.sh`, which drives `emcc` directly. The engine clone
  itself is a build input (~2 GB with its own git history) and is gitignored
  here, not committed — clone upstream at the commit above and apply the patch
  to reproduce it.

This repository's own code (everything outside `public/engine/`) is not
AGPL-licensed by this notice; only the embedded engine build is.
