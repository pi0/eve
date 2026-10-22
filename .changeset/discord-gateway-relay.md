---
"eve": patch
---

The Discord channel can now answer DMs, mentions, and thread replies. `discordChannel({ gateway: {} })` accepts messages forwarded from the Discord Gateway, and `experimental_runDiscordGatewayRelay` from the new `eve/channels/discord/gateway` entry point holds that connection, for example in a Vercel Daemon. In text channels, a mention starts a thread that holds the conversation, and a reply to any bot message continues the session that posted it; set `gateway.startThread: false` to answer in the channel, or return `conversation` or `startThread` from `gateway.onMessage` to decide per message. `defaultDiscordMessageAuth` gives a message's author the same principal `defaultDiscordAuth` gives them for commands and button presses.
