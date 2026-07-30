from .cuffhelp import CuffHelp


async def setup(bot):
    await bot.add_cog(CuffHelp(bot))
