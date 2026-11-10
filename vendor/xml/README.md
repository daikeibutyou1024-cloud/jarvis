# XML parser snapshot

Self-contained ESM bundle of `XMLParser` / `XMLValidator` from fast-xml-parser 5.12.0.
The upstream packages and exact versions are listed in versions.json; their MIT
license notices are retained in LICENSES.txt. No additional service or runtime
package installation is required by the Cloudflare Pages deployment.

Source: https://github.com/NaturalIntelligence/fast-xml-parser
Built with esbuild, tree-shaking the unused XML builder, browser platform,
ES2022 target, ESM format and inline legal comments. Do not hand-edit parser.js.
To update, install a reviewed upstream version in a scratch directory, export
XMLParser and XMLValidator from its package entry, bundle with esbuild, update
versions/licenses, and run the XML, security, Worker and browser tests.
The application additionally rejects DTD and entity declarations before parsing.
