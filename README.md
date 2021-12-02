# vite-plugin-bundled-entry [![npm](https://img.shields.io/npm/v/vite-plugin-bundled-entry.svg)](https://www.npmjs.com/package/vite-plugin-bundled-entry)

### Purpose

Vite goes to great length *not* to bundle anything (in dev), but there are cases where you've got no choice but to bundle.
Some examples are:
- worker (web/shared/service) which need to run as IIFE and *not* `{type: 'module}` (e.g. using `importScripts`)
- JS entry point which needs to be available dynamically at runtime (e.g. in an iframe)

### Installation

```
npm install --save-dev vite-plugin-bundled-entry
```

### Usage

Add it to vite.config.js

```js
import bundledEntryPlugin from 'vite-plugin-bundled-entry';

export default {
  plugins: [bundledEntryPlugin({
    id: 'some_virtual_id',
    outFile: '/assets/mybundle.[hash].js',
    entryPoint: 'src/path/to/entryfile.js',
    esbuildOptions: {
      // (optional) esbuild options to use for bundling
      minify: process.env.NODE_ENV === 'production',
      format: 'iife', // default "esm"
    },
    transform(code) {
      // (optional) transform to apply on generated bundle
    }
  })]
}
```

In your code

```js
import url 'some_virtual_id?url';
// will be /assets/mybundle.[hash].js (with hash placeholder replaced in build mode)

function createWorker() {
  return new Worker(url);
}
```

### License

[MIT](https://opensource.org/licenses/MIT)

Copyright (c) 2021-present, <DIV>Riots
