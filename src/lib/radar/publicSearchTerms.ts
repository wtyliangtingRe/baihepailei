import type { RadarRatingClass } from './ratingPolicy'

const ratingClassSearchAliases: Partial<Record<RadarRatingClass, readonly string[]>> = {
  'B-FEMALE-NTR': ['女性 NTR', '女 NTR'],
  'C-MALE-MAIN-CAST': ['男主角', '男性主角'],
  'C-STRAIGHT-GIRL-HINT': ['直女', '异性恋取向'],
  'D-FUTURE-HET-HINT': ['异性走向', 'BG 倾向'],
  'D-TS-SETTING': ['TS', '性转', '性别转换'],
  'D-FUTA-SETTING': ['扶她', '双性设定'],
  'D-OTOKONOKO-CROSSDRESSING': ['男娘', '女装'],
  'E-ABO': ['ABO', 'Alpha Beta Omega'],
  'E-MALE-INTIMACY': ['男性亲密', '男性恋爱接触'],
  'E-PAST-MALE-ROMANCE': ['前男友', '男性恋爱史'],
  'E-MALE-SUBSTITUTE': ['男性替身', '男性投射', '追男'],
  'E-STRAIGHT-UNREQUITED': ['单恋直女', '直女单恋'],
  'E-MALE-POSSIBILITY': ['男性路线', '可攻略男性'],
  'E-ROUTE-CONTAMINATION': ['混线', '男性线污染'],
  'E-BL-HEAVY': ['BL', '耽美内容'],
  'E-OFFICIAL-DENIAL': ['官方否认百合', '官方拆百合'],
  'E-TOKEN-YURI': ['点缀百合', '百合点缀'],
  'F-HET-END': ['异性结局', '异性恋结局', '嫁男', '男性终局', 'BG 结局'],
  'F-MALE-INTIMACY': ['强制男性亲密', '核心男性亲密'],
  'F-MALE-NTR': ['男性 NTR', '男 NTR', '男性关系背叛'],
  'F-YURI-BAIT': ['百合欺诈', '百合诱饵', '百合营业'],
  'F-SETTING-BAIT': ['设定欺诈', '设定诱饵'],
  'F-MALE-ROMANTIC-AXIS': ['男性恋爱轴', '持续男性轴'],
}

export function publicSearchTermsForRatingClass(ratingClass: RadarRatingClass): readonly string[] {
  return ratingClassSearchAliases[ratingClass] || []
}
