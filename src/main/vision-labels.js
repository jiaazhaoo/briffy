'use strict';
// What macOS's image classifier saw, in the language the app is set to.
//
// The classifier answers with fixed English identifiers from a 1303-entry taxonomy -- "interior_room",
// "sunset_sunrise", "circuit_board" -- and those identifiers are all a wordless picture has. Left in
// English they are useless to someone searching their own log in Chinese, and unlike OCR text or a
// transcript they are not something the user captured: they are the app's own description, so they
// follow the app's language like every other label it writes.
//
// macOS ships no translation for the taxonomy (Photos localises its own categories, not these), so
// this table is the app's. It covers the labels that actually reach a card: the broad categories the
// classifier reaches for most often, plus the specifics common in screenshots, photos and clipboard
// images. Anything outside it falls through as the English identifier rather than being dropped --
// a word in the wrong language still finds the picture; a missing word does not.
const ZH = {
  // people
  people: '人物', person: '人', adult: '成人', baby: '婴儿', child: '儿童', crowd: '人群',
  wedding: '婚礼',
  // animals
  animal: '动物', mammal: '哺乳动物', canine: '犬科', dog: '狗', feline: '猫科',
  cat: '猫', kitten: '小猫', bird: '鸟', fish: '鱼', reptile: '爬行动物', insect: '昆虫',
  horse: '马', cow: '牛', sheep: '羊', pig: '猪', rabbit: '兔', bear: '熊', deer: '鹿',
  fox: '狐狸', coyote_wolf: '狼', lion: '狮子', tiger: '老虎', elephant: '大象',
  butterfly: '蝴蝶', bee: '蜜蜂', spider: '蜘蛛', arachnid: '蛛形纲', turtle: '龟', snake: '蛇',
  owl: '猫头鹰', eagle: '鹰', penguin: '企鹅', whale: '鲸', dolphin: '海豚',
  // plants and nature
  plant: '植物', tree: '树', forest: '森林', vegetation: '植被', grass: '草', foliage: '枝叶',
  flower: '花', garden: '花园', park: '公园', farm: '农场', agriculture: '农业',
  outdoor: '户外', mountain: '山',
  hill: '丘陵', canyon: '峡谷', cliff: '悬崖', rocks: '岩石',
  sand: '沙', desert: '沙漠', beach: '海滩', island: '岛', land: '陆地',
  water: '水', liquid: '液体', ocean: '海洋', lake: '湖', river: '河', waterfall: '瀑布',
  ice: '冰', frozen: '结冰', snow: '雪', glacier: '冰川',
  sky: '天空', cloudy: '多云', sunset_sunrise: '日出日落',
  night_sky: '夜空', moon: '月亮', sun: '太阳',
  storm: '暴风雨', rainbow: '彩虹', fire: '火',
  // places and structures
  structure: '建筑结构', building: '建筑', house_single: '住宅', apartment: '公寓',
  interior_room: '室内房间', kitchen: '厨房', bathroom: '浴室', bedroom: '卧室',
  office_supplies: '办公用品', classroom: '教室', library: '图书馆', museum: '博物馆',
  castle: '城堡', bridge: '桥', tower: '塔', stadium: '体育场',
  restaurant: '餐厅', bar: '酒吧', interior_shop: '店内',
  hospital: '医院', airport: '机场', train_station: '火车站', cityscape: '城市景观',
  street: '街道', road: '道路', path: '小路', alley: '小巷', fence: '栅栏',
  door: '门', portal: '门口', window: '窗', stairs: '楼梯', roof: '屋顶',
  pool: '泳池',
  // things
  material: '材料', machine: '机器', tool: '工具',
  furniture: '家具', table: '桌子', chair: '椅子', sofa: '沙发', bed: '床', bookshelf: '书架',
  lamp: '灯', light: '灯光', clock: '时钟', container: '容器', cardboard_box: '纸箱',
  bag: '包', bottle: '瓶子', cup: '杯子', drinking_glass: '玻璃杯', bowl: '碗', plate: '盘子',
  utensil: '餐具', tableware: '餐具', knife: '刀', fork: '叉子', spoon: '勺子',
  wood_processed: '木制品', newspaper: '报纸',
  clothing: '衣物', shoes: '鞋', hat: '帽子', purse: '手袋', jewelry: '首饰', watch: '手表',
  toy: '玩具', book: '书', magazine: '杂志', newspaper: '报纸', money: '钱',
  // technology
  consumer_electronics: '消费电子', computer: '电脑', laptop: '笔记本电脑', computer_keyboard: '键盘',
  computer_mouse: '鼠标', computer_monitor: '显示器', screenshot: '屏幕', phone: '手机',
  camera: '相机', television: '电视', speakers_music: '音箱', headphones: '耳机', printer: '打印机',
  circuit_board: '电路板', drone_machine: '无人机',
  // documents and graphics
  document: '文档', screenshot: '截图', sign: '标志',
  map: '地图', chart: '图表', diagram: '示意图',
  painting: '绘画作品', art: '艺术', decoration: '装饰',
  illustration: '插画', photo: '照片',
  // vehicles
  conveyance: '交通工具', vehicle: '车辆', car: '汽车', truck: '卡车', bus: '公交车',
  motorcycle: '摩托车', bicycle: '自行车', train: '火车', aircraft: '飞行器', airplane: '飞机',
  helicopter: '直升机', boat: '船', cruise_ship: '邮轮', rocket: '火箭',
  // food
  food: '食物', fruit: '水果', vegetable: '蔬菜', meat: '肉', seafood: '海鲜', bread: '面包',
  cake: '蛋糕', dessert: '甜点', candy: '糖果', chocolate: '巧克力', ice_cream: '冰淇淋',
  pizza: '披萨', pasta: '意面', rice: '米饭', soup: '汤', salad: '沙拉',
  sandwich: '三明治', egg: '鸡蛋', cheese: '奶酪', apple: '苹果', banana: '香蕉',
  coffee: '咖啡', tea_drink: '茶', wine: '葡萄酒', beer: '啤酒', drink: '饮料',
  // activities
  sport: '运动', board_game: '桌游', music: '音乐', concert: '音乐会',
  hiking: '徒步', swimming: '游泳', cycling: '骑行',
  pot_cooking: '锅', handwriting: '手写',
  // colours and form, used by the fallback when nothing is recognised
  black: '黑色', white: '白色', grey: '灰色', red: '红色', orange: '橙色', yellow: '黄色',
  green: '绿色', teal: '青色', blue: '蓝色', purple: '紫色', pink: '粉色', brown: '棕色',
};

/** The label in the given UI language. Anything untranslated keeps its English identifier. */
function label(identifier, ui) {
  const key = String(identifier || '').trim().replace(/ /g, '_');
  if (ui !== 'zh') return key.replace(/_/g, ' ');
  return ZH[key] || key.replace(/_/g, ' ');
}

module.exports = { label, ZH };
