from .cuffmemorial import CuffMemorial


async def setup(bot):
    await bot.add_cog(CuffMemorial(bot))
