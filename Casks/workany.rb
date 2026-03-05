# typed: false
# frozen_string_literal: true

cask "workany" do
  arch arm: "aarch64", intel: "474195668fa93d9bffad26127fe1de8bf0464390a149c36aaf42ee15de8c4878"

  version "0.1.17"
  sha256 arm:   "5c88b77d93e21fe0aa4c3a581c29013fcf3166ab5d7f1fcfcb6f8e226f1c58c9",
         intel: "474195668fa93d9bffad26127fe1de8bf0464390a149c36aaf42ee15de8c4878"

  url "https://github.com/workany-ai/workany/releases/download/v#{version}/WorkAny_#{version}_#{arch}.dmg",
      verified: "github.com/workany-ai/workany/"
  name "WorkAny"
  desc "AI-powered work assistant with Claude Code and Codex integration"
  homepage "https://github.com/workany-ai/workany"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :monterey"

  app "WorkAny.app"

  postflight do
    # Remove quarantine attribute to prevent Gatekeeper issues
    system_command "/usr/bin/xattr",
                   args: ["-r", "-d", "com.apple.quarantine", "#{appdir}/WorkAny.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/ai.thinkany.workany",
    "~/Library/Caches/ai.thinkany.workany",
    "~/Library/Logs/ai.thinkany.workany",
    "~/Library/Preferences/ai.thinkany.workany.plist",
    "~/Library/Saved Application State/ai.thinkany.workany.savedState",
  ]
end
