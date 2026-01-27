# typed: false
# frozen_string_literal: true

cask "workany" do
  arch arm: "aarch64", intel: "715de46c1cd843c35182811a48e515619252bdd0fe094eca3962348d8ca4da96"

  version "0.1.14"
  sha256 arm:   "8e452e4212b205478450bd803c3d7f4df50de698d9069c928363190a789bf814",
         intel: "715de46c1cd843c35182811a48e515619252bdd0fe094eca3962348d8ca4da96"

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
