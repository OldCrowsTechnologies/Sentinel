/**
 * withFmtFix.js -- Expo config plugin to unblock iOS builds on Xcode 26.
 *
 * React Native 0.79 (Expo SDK 53) bundles a `fmt` version whose consteval-based
 * format-string checking fails to compile under the newer Clang in Xcode 26+:
 *   "call to consteval function 'fmt::basic_format_string<...>' is not a
 *    constant expression"
 * Apple now REQUIRES Xcode 26 for submissions, so we can't just use an older
 * image. Defining FMT_USE_CONSTEVAL=0 makes fmt fall back to runtime format
 * checking (FMT_CONSTEVAL expands to empty), which compiles cleanly. Applied to
 * every pod target via the Podfile post_install hook during EAS prebuild.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const INJECT = `
    # withFmtFix: unblock fmt consteval under Xcode 26 (RN 0.79 / SDK 53)
    installer.pods_project.targets.each do |t|
      t.build_configurations.each do |bc|
        d = bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        d = [d] unless d.is_a?(Array)
        d << 'FMT_USE_CONSTEVAL=0' unless d.include?('FMT_USE_CONSTEVAL=0')
        bc.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = d
      end
    end
`;

module.exports = function withFmtFix(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes('withFmtFix')) {
        // Insert at the top of the existing `post_install do |installer|` block.
        contents = contents.replace(/post_install do \|installer\|/, `post_install do |installer|\n${INJECT}`);
        fs.writeFileSync(podfile, contents);
      }
      return config;
    },
  ]);
};
