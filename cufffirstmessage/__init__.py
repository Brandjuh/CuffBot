from .cufffirstmessage import CuffFirstMessage


async def setup(bot):
    await bot.add_cog(CuffFirstMessage(bot))
