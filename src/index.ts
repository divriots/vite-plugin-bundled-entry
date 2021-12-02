import { build, BuildOptions, BuildResult } from "esbuild";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import type { PluginContext } from "rollup";
import { createHash } from "crypto";

export interface BundledEntryPluginOptions {
  id: string;
  outFile: string;
  entryPoint: string;
  esbuildOptions?: BuildOptions;
  transform?(code: string): string;
}

export default function bundledEntryPlugin(
  opts: BundledEntryPluginOptions
): Plugin {
  let config: ResolvedConfig;
  let isBuild: boolean;
  let server: ViteDevServer;
  let bundle: Promise<BuildResult>;
  let esbuildOptions: BuildOptions;
  async function generate() {
    if (!bundle) bundle = build(esbuildOptions);
    const result = await bundle;
    const { text: code } = result.outputFiles?.find((it) =>
      it.path.endsWith(esbuildOptions.outfile || "<stdout>")
    )!;
    const sourcemap = result.outputFiles?.find((it) =>
      it.path.endsWith(".map")
    );
    return {
      code,
      map: sourcemap?.text,
    };
  }
  let emitter: Promise<string>;
  function emit(context: PluginContext) {
    if (!emitter) {
      emitter = generate().then(({ code }) => {
        const contentHash = getAssetHash(Buffer.from(code));
        const url = opts.outFile.replace(/\[hash\]/, contentHash);
        context.emitFile({
          id: opts.id,
          fileName: url.slice(1),
          type: "chunk",
        });
        return url;
      });
    }
    return emitter;
  }
  async function getUrl(context: PluginContext) {
    if (isBuild) {
      return await emit(context);
    } else {
      return opts.outFile;
    }
  }
  return {
    name: `vite:plugin:bundled:entry:${opts.id}`,
    // enforce: 'post',
    configResolved(c) {
      config = c;
      isBuild = config.command === "build";
      esbuildOptions = {
        absWorkingDir: config.root,
        entryPoints: [opts.entryPoint],
        format: "esm",
        outfile: `bundle_${opts.id.replace(/[^a-zA-Z_]+/g, '_')}`,
        sourcemap: isBuild ? false : 'external',
        ...opts.esbuildOptions,
        define: {
          ...config.define,
          ...(opts.esbuildOptions?.define || {}),
        },
        bundle: true,
        write: false,
        watch: isBuild
          ? false
          : {
              onRebuild(error, result) {
                if (error) {
                  console.error(error);
                  return;
                }
                bundle = Promise.resolve(result!);
                // TODO invalidate just the bundle
                server.moduleGraph.invalidateAll();
                server.ws.send({
                  type: "full-reload",
                  path: "*",
                });
              },
            },
      };
    },
    configureServer(s) {
      server = s;
    },
    async resolveId(id, importer) {
      if (id.startsWith(opts.id)) {
        return "\0" + id;
      }
      if (id.startsWith(opts.outFile)) {
        if (isBuild) {
          return {
            id: await emit(this),
            external: true,
          };
        } else {
          return "\0" + opts.id;
        }
      }
    },
    async buildStart() {
      // ensures our entry gets emitted no matter what
      if (isBuild) await emit(this);
    },
    async transform(code, id) {
      if (
        id.startsWith("\0" + opts.id) &&
        !isBuild &&
        !id.includes("?url") &&
        opts.transform
      ) {
        return opts.transform(code);
      }
    },
    async load(id) {
      if (id.startsWith("\0" + opts.id)) {
        if (id.includes("?url"))
          return `export default '${await getUrl(this)}'`;
        // in build mode, will be renderer in renderChunk
        return isBuild ? "" : await generate();
      }
    },
    renderChunk(code, { facadeModuleId }) {
      // during build mode, generate chunk at render time to avoid re-processing the esbuild output through rollup
      if (facadeModuleId === "\0" + opts.id) {
        return generate();
      }
      return null;
    },
    async closeBundle() {
      if (!isBuild && bundle) {
        // stops esbuild watcher
        await (
          await bundle
        ).stop!();
      }
    },
  };
}

function getAssetHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}
