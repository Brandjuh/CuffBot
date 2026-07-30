from .cuffbirthday import CuffBirthday


async def setup(bot):
    await bot.add_cog(CuffBirthday(bot))
