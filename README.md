# vite-plugin-bundled-entry [![npm](https://img.shields.io/npm/v/vite-plugin-bundled-entry.svg)](https://www.npmjs.com/package/vite-plugin-bundled-entry)

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
    id: '/some_url',
    entryPoint: 'path/to/entryfile.js',
    esbuildOptions: {
      // esbuild options to use for bundling
    }
  })]
}
```

### License

[MIT](https://opensource.org/licenses/MIT)

Copyright (c) 2021-present, <DIV>Riots
