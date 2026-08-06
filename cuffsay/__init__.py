from .cuffsay import CuffSay

__red_end_user_data_statement__ = "This cog does not store any user data."


async def setup(bot):
    await bot.add_cog(CuffSay(bot))
