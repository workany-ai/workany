# typed: false
# frozen_string_literal: true

cask "workany" do
  arch arm: "aarch64", intel: "f61b0cc7808bc6309431b112b51332eaea891254674b5f2321c04041daa74904"

  version "0.1.15"
  sha256 arm:   "db1b37acb9b1fbe134e732c15fca8eb8d2da303d7f36563cd0cca424e8fafa3b",
         intel: "f61b0cc7808bc6309431b112b51332eaea891254674b5f2321c04041daa74904"

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
