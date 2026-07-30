from .cuffchatstarter import CuffChatStarter


async def setup(bot):
    await bot.add_cog(CuffChatStarter(bot))
