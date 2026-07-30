from .cuffrecords import CuffRecords


async def setup(bot):
    await bot.add_cog(CuffRecords(bot))
