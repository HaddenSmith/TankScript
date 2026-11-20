# TeaVM experiment — third-party notices

This experiment builds open-source toolchain assets locally; binaries are
ignored by Git. No CheerpJ/proprietary runtime assets are copied. Retain these
notices with any copy of this experiment and its generated assets.

- **TeaVM / teavm-javac**, copyright Alexey Andreev and contributors:
  [Apache License 2.0](licenses/Apache-2.0.txt) and
  [TeaVM NOTICE](licenses/TeaVM-NOTICE.txt). Sources:
  [TeaVM 0.16.0](https://github.com/konsoletyper/teavm/tree/0.16.0),
  [browser compiler revision](https://github.com/konsoletyper/teavm-javac/tree/cf274939233f390b4bc92413c2b057ab14c323d3),
  [SDK fix](https://github.com/konsoletyper/teavm-javac/commit/76b5b53850f74e510ec8588a56a211cf60e9d496).
  The build recipe backports that fix, changes its ArchiveBuilder import,
  supplies build metadata, and repacks resource paths/order for Windows.
  The JavaScript loader variant is additionally modified to replace code
  generation with static wrappers and a fixed helper list. The generated file
  carries the attribution/modification notice. Its exact reproducible patch is
  `prepare-csp-runtime.mjs` plus `csp-runtime-support.js`; retain these with the
  Apache license and NOTICE when distributing the modified loader/source.
- **OpenJDK javac and included definitions**, Oracle/OpenJDK contributors:
  [GPL v2 with Classpath Exception](licenses/OpenJDK-GPL-2.0-with-classpath-exception.txt),
  [additional license information](licenses/OpenJDK-ADDITIONAL_LICENSE_INFO.txt).
  [Exact corresponding source](https://github.com/openjdk/jdk25u/tree/6c48f4ed707bf0b15f9b6098de30db8aae6fa40f)
  is also downloaded into the local build cache; javac source is not modified.
  The Classpath Exception does not remove obligations for redistribution of
  the compiler itself.

The compiler's dependencies include [ASM 9.8](licenses/ASM-BSD.txt),
[JZlib 1.1.3](licenses/JZlib-BSD.txt), and TeaVM's class-library
resources, including [Unicode/CLDR 37 data](licenses/Unicode-CLDR-37.txt).
The setup recipe, pinned revisions, local source archives and Gradle artifacts
identify the actual components. Before publishing a binary distribution,
complete its third-party/source distribution inventory; this local evaluation
is not a prepackaged production runtime or a licensing clearance for one.
