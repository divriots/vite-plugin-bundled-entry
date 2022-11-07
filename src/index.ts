import { build, BuildOptions, BuildResult } from "esbuild";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import type { PluginContext } from "rollup";
import { createHash } from "crypto";
import * as path from "path";
import * as fs from "fs";

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
  let result: BuildResult | undefined;
  let esbuildOptions: BuildOptions;
  const watchedFiles = new Set<string>();
  async function generate(context: PluginContext) {
    const firstRun = !result;
    if (!result) {
      result = await build(esbuildOptions)
      if (!isBuild) {
        const onChange = (changedFile: string) => {
          if (watchedFiles.has(changedFile)) {
            const mod = server.moduleGraph.getModuleById('\0'+opts.id)
            if (mod) {
              server.moduleGraph.invalidateModule(mod);
            }
            server.ws.send({
              type: "full-reload",
              path: "*",
            });
          }
        }
        server.watcher.on('add', onChange);
        server.watcher.on('change', onChange);
        server.watcher.on('unlink', onChange);
      }
    } else if (result.rebuild) {
      result = await result.rebuild();
    }
    for (const file in result.metafile?.inputs) {
      if (file.includes('\0')) continue;
      const resolved = path.resolve(config.root, file);
      if (fs.existsSync(resolved)) {
        watchedFiles.add(resolved)
        server?.watcher?.add(resolved);
        if (firstRun) {
          context.addWatchFile(resolved);
        }
      }
    }
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
  let emitter: Promise<string> | undefined;
  function emit(context: PluginContext) {
    if (!emitter) {
      emitter = generate(context).then(({ code }) => {
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
    configResolved(c) {
      config = c;
      isBuild = config.command === "build";
      const isBuildWatch = !!config.build.watch;
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
        incremental: !isBuild,
        metafile: !isBuild || isBuildWatch
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
            id: (await emit(this)).slice(1),
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
        return isBuild ? "" : await generate(this);
      }
    },
    renderChunk(code, { facadeModuleId }) {
      // during build mode, generate chunk at render time to avoid re-processing the esbuild output through rollup
      if (facadeModuleId === "\0" + opts.id) {
        return generate(this);
      }
      return null;
    },
    async closeBundle() {
      result?.rebuild?.dispose();
      result = undefined;
      emitter = undefined;
    },
  };
}

function getAssetHash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8);
}
