# typed: false
# frozen_string_literal: true

cask "workany" do
  arch arm: "aarch64", intel: "f737a59b284c09e01193d1a236bf11777114b10070f5957aad5b4197a10a0b96"

  version "0.1.18"
  sha256 arm:   "98afbda6cb1c3f583e54a8bb8ec1894379af50b767ddc091f07b05f83e8e0ca6",
         intel: "f737a59b284c09e01193d1a236bf11777114b10070f5957aad5b4197a10a0b96"

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
