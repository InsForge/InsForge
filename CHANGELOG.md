# Changelog

## [1.5.8](https://github.com/InsForge/insforge/compare/v1.5.8-admin...v1.5.8) (2026-02-27)



## [1.5.8-admin](https://github.com/InsForge/insforge/compare/v1.5.8-admin...v1.5.8) (2026-02-26)


### Bug Fixes

* address CodeRabbit feedback for AI usage FK migration ([973a717](https://github.com/InsForge/insforge/commit/973a717e7dae2fda5e24e41f4750b5ac8ffaac1b))
* **ai:** allow disabling models with usage history ([b38e0da](https://github.com/InsForge/insforge/commit/b38e0dac3912b0bde64431aeb22d4feaec0a7178))
* **ai:** make disable idempotent and strengthen tests ([c21827a](https://github.com/InsForge/insforge/commit/c21827ae045c24f1ca990df0b7ae9adb964b7da6))
* **ai:** soft-disable configurations with is_active ([d9dcaf8](https://github.com/InsForge/insforge/commit/d9dcaf8920a8052f385e2c6a4925672db79823fe))
* allow admin refresh token without admin record ([773e0df](https://github.com/InsForge/insforge/commit/773e0dfc9f90de66f617d3ea496da2246c778d5d))
* disable no-control-regex for ANSI escape stripping ([11d0ee5](https://github.com/InsForge/insforge/commit/11d0ee5e93197d74e01abb964812a96cdbe5c83a))
* disable noImplicitAny for deno check and block Deno.serve() pattern ([e6cf105](https://github.com/InsForge/insforge/commit/e6cf105b65288736a67372d9abc3f5b1099a5b8f))
* distinguish ENOENT from other errors in checkCode catch handler ([f1fd067](https://github.com/InsForge/insforge/commit/f1fd0678e26fd6d0b13ca0ae5184f04cb4a11b4a))
* only run deno check when Deno Subhosting is configured ([13b03f5](https://github.com/InsForge/insforge/commit/13b03f55beec32618c5216c508321a60fea10a83))
* prevent mixing S3 and AWS credentials in storage provider ([706ce49](https://github.com/InsForge/insforge/commit/706ce495514785fa09a3b0ea3fcd0ea6377f37cd))
* resolve eslint curly and no-control-regex errors ([cd7cec9](https://github.com/InsForge/insforge/commit/cd7cec9d0deae5d5ff3ee90989fc990a62682aef))
* use docs/** glob so negation patterns re-include needed docs ([9bfcfc3](https://github.com/InsForge/insforge/commit/9bfcfc3eb891631a0176e514e815a37ce1656661))
* use NO_COLOR env instead of parsing ANSI from deno check output ([8c800bb](https://github.com/InsForge/insforge/commit/8c800bb8bbf6eaf17263a3b8a0cf5e8fb61ed4fc))
* use String.fromCharCode to avoid control char in source ([48a48a5](https://github.com/InsForge/insforge/commit/48a48a51beb3b1e0b52619707dd5465602bf1f7b))
* use unicode escape and consistent arrow formatting in deno check output ([74ee0ff](https://github.com/InsForge/insforge/commit/74ee0ff0395ef633d1a84d303d97e21b42a0cae0))


### Features

* add deno check pre-validation for edge functions ([95fd268](https://github.com/InsForge/insforge/commit/95fd26856b96fb47761ef80475b683ad09c3c743))
* add S3-compatible storage provider support (Wasabi, MinIO, etc.) ([d3eae5e](https://github.com/InsForge/insforge/commit/d3eae5ebabb7dd2fd43e6081de790e3dff031588))



## [1.5.7-storageLimit4](https://github.com/InsForge/insforge/compare/v1.5.8-admin...v1.5.8) (2026-02-15)


### Bug Fixes

* remove hardcoded 50MB CSV file size check from frontend ([c1daf24](https://github.com/InsForge/insforge/commit/c1daf244f8d1b0a313ea2ca6bdcec78a250fe3fb))



## [1.5.7-storageLimit2](https://github.com/InsForge/insforge/compare/v1.5.8-admin...v1.5.8) (2026-02-15)

## [1.5.6](https://github.com/InsForge/insforge/compare/v1.5.5-e2e-1...v1.5.6) (2026-02-13)

## [1.5.4](https://github.com/InsForge/InsForge/compare/v1.5.3-e2e-5...v1.5.4) (2026-02-07)

# [1.4.0](https://github.com/InsForge/InsForge/compare/v1.3.1-e2e.2...v1.4.0) (2025-12-19)

## [1.2.8](https://github.com/InsForge/InsForge/compare/v1.2.6...v1.2.8) (2025-12-05)

## [1.2.6](https://github.com/InsForge/InsForge/compare/v1.2.4...v1.2.6) (2025-11-22)

## [1.2.4](https://github.com/InsForge/InsForge/compare/v1.2.3...v1.2.4) (2025-11-22)

## [1.2.2](https://github.com/InsForge/InsForge/compare/v1.2.1-e2e...v1.2.2) (2025-11-18)

# [1.2.0](https://github.com/InsForge/InsForge/compare/v1.1.7-Nov13...v1.2.0) (2025-11-15)

## [1.1.2](https://github.com/InsForge/InsForge/compare/v1.1.0-posthog-9...v1.1.2) (2025-10-28)


### Bug Fixes

* addressing coderabbit comments ([97dd933](https://github.com/InsForge/InsForge/commit/97dd9339269991955d8c644f88e77efa6c3f6da2))
* macOS compatibility and AI config cleanup for e2e tests ([2e04d79](https://github.com/InsForge/InsForge/commit/2e04d7920b00a2b19eed1f0aa3072a6ea937f41a))
* removing package-lock ([9df772d](https://github.com/InsForge/InsForge/commit/9df772dcadd3a91e2fa70507d8f2779f6910d484))
* removing package-lock ([222dfc1](https://github.com/InsForge/InsForge/commit/222dfc1231504ce8e7d14d5ab79e57c1b00785c7))
* update the frontend to use the bulk-upsert exising API ([2b9b3b2](https://github.com/InsForge/InsForge/commit/2b9b3b23c4cc2d401781ba5504c54db07bb84af0))


### Features

* added tests for ai configs ([2a4e93a](https://github.com/InsForge/InsForge/commit/2a4e93acf145699511bd0ea49e29926f2d585b36))
* added tests for functions and secrets ([a985f03](https://github.com/InsForge/InsForge/commit/a985f035ffc1c1152999b317cf4e03e0f45ba34e))
* added tests for logs ([81f7734](https://github.com/InsForge/InsForge/commit/81f7734f3586e03ae2be5694b63d2a3417ae7339))
* fixed all the tests with correct format ([1242d13](https://github.com/InsForge/InsForge/commit/1242d133efd4398ae672e1e6c71ae1431aa9ba62))
* fixed secret tests ([5703836](https://github.com/InsForge/InsForge/commit/5703836ecee0ffeb27bfca9b0d785b95e68f1688))
* updated the backend and the service to update the csv parsing and validating ([e7ffd29](https://github.com/InsForge/InsForge/commit/e7ffd292fd93381ae2eebde17c16e3996241f15c))
* updated the frontend to display the button and the respective functions ([50613d8](https://github.com/InsForge/InsForge/commit/50613d8d972b88cf28b147bb7a44901c23d77e79))

# [1.1.0](https://github.com/InsForge/InsForge/compare/v1.0.1-ai-2...v1.1.0) (2025-10-11)


### Bug Fixes

* typo in docs ([d2a0efc](https://github.com/InsForge/InsForge/commit/d2a0efc56ab77560597dc2ee46c5f8a669fbd71d))

# [1.0.0](https://github.com/InsForge/InsForge/compare/v0.3.3...v1.0.0) (2025-09-29)

# [0.3.0](https://github.com/InsForge/InsForge/compare/v0.2.9-fix...v0.3.0) (2025-09-26)
