# pnpm v11 build approval

This repository uses pnpm 11.

pnpm 11 removed the legacy `onlyBuiltDependencies` setting and replaced it with `allowBuilds`.

The project explicitly allows install/build scripts only for the dependencies required by the current toolchain:

```yaml
allowBuilds:
  esbuild: true
  sharp: true
```

This keeps `strictDepBuilds` protection enabled while allowing the known esbuild and sharp install scripts.

Verification:

```powershell
node --test tests/pnpm-build-policy.test.mjs
pnpm install
```

Do not enable `dangerouslyAllowAllBuilds`; new dependencies with build scripts should be reviewed and added individually.
