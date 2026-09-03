# R8 mapping files, one per uploaded release

`mapping.txt` is what turns an obfuscated crash (`a.b.c(Unknown Source)`) back
into a readable one. R8 writes it to `app/build/outputs/mapping/release/` and
nothing keeps it: the next `gradle clean`, or the next build with a different
config, replaces it. Play holds a copy inside every uploaded bundle and
de-obfuscates crash reports on its own, but a local copy is what makes a
logcat trace from a user's device readable here.

One gzipped file per versionCode that was cut for upload, archived at build
time so it exists before anyone can `clean`. If a cut is abandoned before
upload, delete its entry — versionCode 10 has none because it was never cut
this way.

```bash
# after every upload:
gzip -9 -c app/build/outputs/mapping/release/mapping.txt > mappings/versionCode-<N>.txt.gz
# to read a trace:
gunzip -c mappings/versionCode-11.txt.gz > /tmp/m.txt
$ANDROID_HOME/cmdline-tools/latest/bin/retrace /tmp/m.txt < trace.txt
```
