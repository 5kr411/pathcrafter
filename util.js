function getItemCountInInventory(bot, itemName) {
    return bot.inventory.items()
        .filter(item => item.name === itemName)
        .reduce((total, item) => total + item.count, 0)
}

module.exports = {
    getItemCountInInventory
}