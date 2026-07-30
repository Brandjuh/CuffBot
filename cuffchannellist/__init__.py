from .cuffchannellist import CuffChannelList


async def setup(bot):
    await bot.add_cog(CuffChannelList(bot))
