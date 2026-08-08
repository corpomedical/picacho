// eslint-config-next 16 ships native ESLint 9 flat configs (plain arrays),
// not the old eslintrc-shareable-config format — importing them directly
// here instead of routing through @eslint/eslintrc's FlatCompat.extends().
// FlatCompat expects to *convert* legacy configs into flat config, and
// feeding it an already-flat array (containing eslint-plugin-react-hooks 7's
// flat-config-native, self-referential plugin object) made its internal
// error-formatter crash with "Converting circular structure to JSON" instead
// of ever loading — this sidesteps the shim entirely.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // eslint-plugin-react-hooks v7 (new, ships as part of Next 16's
      // eslint-config-next) adds this rule as an error by default. It flags
      // every setState-inside-useEffect call — including intentional,
      // correct ones already in this codebase: deferring a localStorage
      // read past first render to avoid a hydration mismatch, resetting
      // chat state when the selected character changes, closing the mobile
      // drawer on route change, consuming a one-time ?voice=/?prompt= query
      // param. Rewriting all of those to dodge the rule risks introducing
      // real bugs for no functional gain, so this is downgraded to a
      // warning rather than left as a build-breaking error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default eslintConfig;
