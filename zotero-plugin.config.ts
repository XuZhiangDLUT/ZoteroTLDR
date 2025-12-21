import { defineConfig } from "zotero-plugin-scaffold";
import pkg from "./package.json";

// Any pre-release build (version includes "-") is treated as the test channel.
const updateFileName = pkg.version.includes("-")
  ? "update-beta.json"
  : "update.json";

export default defineConfig({
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  // Host update manifests in-repo so we don't need an extra "release" manifest tag/release.
  // Stable: updates/update.json, Test: updates/update-beta.json
  updateURL: `https://raw.githubusercontent.com/{{owner}}/{{repo}}/main/updates/${updateFileName}`,
  xpiDownloadLink:
    "https://github.com/{{owner}}/{{repo}}/releases/download/v{{version}}/{{xpiName}}.xpi",

  release: {
    github: {
      // We manage update manifests as committed files under /updates.
      updater: false,
    },
  },

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },

  // If you need to see a more detailed log, uncomment the following line:
  // logLevel: "trace",
});
