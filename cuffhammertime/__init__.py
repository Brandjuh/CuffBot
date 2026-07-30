from .cuffhammertime import CuffHammertime


async def setup(bot):
    await bot.add_cog(CuffHammertime(bot))
