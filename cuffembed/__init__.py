from .cuffembed import CuffEmbed


async def setup(bot):
    await bot.add_cog(CuffEmbed(bot))
