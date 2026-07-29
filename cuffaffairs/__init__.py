from .cuffaffairs import CuffAffairs


async def setup(bot):
    await bot.add_cog(CuffAffairs(bot))
