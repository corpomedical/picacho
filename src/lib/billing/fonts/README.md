# Invoice fonts

The Screening Room's three faces, as static TrueType instances, because the PDF
writer (pdf-lib + fontkit) embeds fonts but cannot pick an instance out of a
variable font. Made from the same Google Fonts files the app loads through
next/font (latin subset: all of Latin-1, plus – — ’ “ ” • € − …), with
fontTools' `varLib.instancer`:

| File | Source | Instance |
| --- | --- | --- |
| Archivo-ExpandedExtraBold.ttf | Archivo | wdth 125, wght 800 (the `marquee` title) |
| Archivo-Regular.ttf | Archivo | wdth 100, wght 400 |
| Archivo-SemiBold.ttf | Archivo | wdth 100, wght 600 |
| Newsreader-Regular.ttf | Newsreader | wght 400 (numerals) |
| Newsreader-Medium.ttf | Newsreader | wght 500 |
| Newsreader-SemiBold.ttf | Newsreader | wght 600 |
| DMMono-Regular.ttf | DM Mono | 400 (the `slate` labels) |
| DMMono-Medium.ttf | DM Mono | 500 |

Licensed under the SIL Open Font License 1.1 (https://openfontlicense.org):

- Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)
- Copyright 2020 The DM Mono Project Authors (https://www.github.com/googlefonts/dm-mono)
- Copyright 2020 The Newsreader Project Authors (http://github.com/productiontype/Newsreader)

The files ship with the invoice route only (`outputFileTracingIncludes` in
next.config.ts), and are embedded as subsets in each PDF.
