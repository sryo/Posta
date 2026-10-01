import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

// Suites that touch no DOM API. Building a jsdom window per file dominates
// their run time; a suite that later needs one fails with "document is not
// defined" and belongs back in the jsdom project.
const NO_DOM = [
  "src/App.css.test.ts",
  "src/App.css.color.test.ts",
  "src/App.css.contrast.test.ts",
  "src/App.css.global.test.ts",
  "src/App.css.postmark.test.ts",
  "src/App.css.type.test.ts",
  "src/api/commandContract.test.ts",
  "src/app/actionOrder.test.ts",
  "src/app/authErrors.test.ts",
  "src/app/batchReply.test.ts",
  "src/app/bulkKeys.test.ts",
  "src/app/cardType.test.ts",
  "src/app/cidImages.test.ts",
  "src/app/coalesce.test.ts",
  "src/app/composePlacement.test.ts",
  "src/app/contacts.test.ts",
  "src/app/dateFormat.test.ts",
  "src/app/eventForm.test.ts",
  "src/app/errorText.test.ts",
  "src/app/eventReply.test.ts",
  "src/app/grouping.test.ts",
  "src/app/dayStrip.test.ts",
  "src/app/inviteDays.test.ts",
  "src/app/nowSection.test.ts",
  "src/app/inviteRow.test.ts",
  "src/app/keyboardNav.test.ts",
  "src/app/loadErrors.test.ts",
  "src/app/mailto.test.ts",
  "src/app/messages.test.ts",
  "src/app/pendingSend.test.ts",
  "src/app/postmark.test.ts",
  "src/app/signature.test.ts",
  "src/app/storedWidth.test.ts",
  "src/app/threadActions.test.ts",
  "src/app/transit.test.ts",
  "src/test/buildTarget.test.ts",
  "src/test/css.test.ts",
  "src/test/environment.test.ts",
  "src/test/inlineColor.test.ts",
  "src/test/inlineType.test.ts",
  "src/test/release.test.ts",
  "src/test/site.test.ts",
  "src/test/verifyMacosBundle.test.ts",
];

export default defineConfig({
  // Hot reload only matters in the dev server; under vitest on Windows its
  // "/@solid-refresh" import resolves to a path Node rejects
  plugins: [solid({ hot: false })],
  resolve: {
    conditions: ["development", "browser"],
  },
  test: {
    globals: false,
    // The App suites wait on real timers of up to ~2s; on a loaded machine
    // the 5s default fails them spuriously.
    testTimeout: 15_000,
    setupFiles: ["./src/test/setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: NO_DOM,
        },
      },
      {
        extends: true,
        test: { name: "node", environment: "node", include: NO_DOM },
      },
    ],
  },
});
