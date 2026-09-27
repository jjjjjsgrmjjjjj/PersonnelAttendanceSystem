'use strict';
/**
 * 名单与分组数据（来源：示例中学新媒体中心示例影像部示例季第01届田径运动会人员分工表.docx）
 *
 * 说明：
 * - 表中“总负责人”不单独设组，其归属写在 note 里，避免重复出勤记录。
 * - 一个人出现在多个组时，只建一条人员记录，通过 memberships 表挂到多个组；
 *   出勤按“人 + 日期 + 时段”唯一记录，一组填了，其他组自动看到。
 * - 按用户要求：航拍组另加 成员33（高二九班）。
 */

const GROUPS = [
  { key: 'jing_sai', name: '径赛组', sort: 1 },
  { key: 'tian_sai', name: '田赛组', sort: 2 },
  { key: 'zi_you', name: '自由组', sort: 3 },
  { key: 'qu_wei', name: '趣味项目摄像组', sort: 4 },
  { key: 'di_mian_cai_pan', name: '地面视频裁判组', sort: 5 },
  { key: 'she_ying', name: '摄影组', sort: 6 },
  { key: 'hang_pai', name: '航拍组', sort: 7 },
  { key: 'di_kong_cai_pan', name: '低空视频裁判组', sort: 8 },
  { key: 'diao_du', name: '调度剪辑运维组', sort: 9 },
];

// 人员：name 姓名, cls 班级, primary 主组, extra 兼任的其它组, role 组内角色, note 备注
const MEMBERS = [
  // 总负责人（不设独立组，归属见 note）
  { name: '成员11', cls: '高二十二班', primary: 'diao_du', role: '组长', extra: [], note: '总负责人；调度剪辑运维组组长' },
  { name: '成员44', cls: '高二十四班', primary: 'zi_you', role: '组长', extra: ['she_ying'], note: '总负责人；自由组组长、摄影组组长' },
  { name: '成员23', cls: '高二四班', primary: 'hang_pai', role: '组长', extra: [], note: '总负责人；航拍组组长' },
  { name: '成员10', cls: '高二十三班', primary: 'diao_du', role: '组员', extra: [], note: '总负责人；调度剪辑运维组组员' },

  // 径赛组
  { name: '成员17', cls: '高二十一班', primary: 'jing_sai', role: '组长', extra: [], note: '' },
  { name: '成员13', cls: '高一五班', primary: 'jing_sai', role: '组员', extra: [], note: '' },
  { name: '成员42', cls: '高一十三班', primary: 'jing_sai', role: '组员', extra: [], note: '' },
  { name: '成员39', cls: '高二四班', primary: 'jing_sai', role: '组员', extra: [], note: '' },
  { name: '成员15', cls: '高一二班', primary: 'jing_sai', role: '组员', extra: [], note: '' },

  // 田赛组
  { name: '成员32', cls: '高二六班', primary: 'tian_sai', role: '组长', extra: [], note: '' },
  { name: '成员28', cls: '高二十二班', primary: 'tian_sai', role: '组员', extra: [], note: '' },
  { name: '成员31', cls: '高二十三班', primary: 'tian_sai', role: '组员', extra: [], note: '' },
  { name: '成员07', cls: '高二四班', primary: 'tian_sai', role: '组员', extra: [], note: '' },
  { name: '成员40', cls: '高一九班', primary: 'tian_sai', role: '组员', extra: [], note: '' },

  // 自由组
  { name: '成员27', cls: '高一十三班', primary: 'zi_you', role: '组员', extra: [], note: '' },
  { name: '成员02', cls: '高二十四班', primary: 'zi_you', role: '组员', extra: [], note: '' },
  { name: '成员21', cls: '高二二班', primary: 'zi_you', role: '组员', extra: [], note: '' },
  { name: '成员16', cls: '高二六班', primary: 'zi_you', role: '组员', extra: [], note: '' },
  { name: '成员06', cls: '高二五班', primary: 'zi_you', role: '组员', extra: [], note: '' },

  // 趣味项目摄像组
  { name: '成员45', cls: '高二十二班', primary: 'qu_wei', role: '组长', extra: [], note: '' },
  { name: '成员01', cls: '高一六班', primary: 'qu_wei', role: '组员', extra: [], note: '' },
  { name: '成员30', cls: '高一十一班', primary: 'qu_wei', role: '组员', extra: [], note: '' },
  { name: '成员29', cls: '高一三班', primary: 'qu_wei', role: '组员', extra: ['di_kong_cai_pan'], note: '' },
  { name: '成员43', cls: '高一十三班', primary: 'qu_wei', role: '组员', extra: [], note: '' },

  // 地面视频裁判组
  { name: '成员08', cls: '高二十四班', primary: 'di_mian_cai_pan', role: '组长', extra: [], note: '' },
  { name: '成员14', cls: '高一七班', primary: 'di_mian_cai_pan', role: '组员', extra: [], note: '' },
  { name: '成员20', cls: '高二十二班', primary: 'di_mian_cai_pan', role: '组员', extra: [], note: '' },
  { name: '成员26', cls: '高二十四班', primary: 'di_mian_cai_pan', role: '组员', extra: [], note: '' },
  { name: '成员03', cls: '高二九班', primary: 'di_mian_cai_pan', role: '组员', extra: [], note: '' },

  // 摄影组
  { name: '成员19', cls: '高一一班', primary: 'she_ying', role: '组员', extra: ['di_kong_cai_pan'], note: '兼低空视频裁判组组长' },
  { name: '成员41', cls: '高一十四班', primary: 'she_ying', role: '组员', extra: [], note: '' },
  { name: '成员25', cls: '高一六班', primary: 'she_ying', role: '组员', extra: [], note: '' },
  { name: '成员09', cls: '高一四班', primary: 'she_ying', role: '组员', extra: [], note: '' },

  // 航拍组（按要求新增 成员33）
  { name: '成员18', cls: '高一十三班', primary: 'hang_pai', role: '组员', extra: [], note: '' },
  { name: '成员34', cls: '高二四班', primary: 'hang_pai', role: '组员', extra: [], note: '' },
  { name: '成员36', cls: '高二二班', primary: 'hang_pai', role: '组员', extra: [], note: '' },
  { name: '成员38', cls: '高二十一班', primary: 'hang_pai', role: '组员', extra: [], note: '' },
  { name: '成员24', cls: '高一十三班', primary: 'hang_pai', role: '组员', extra: [], note: '' },
  { name: '成员33', cls: '高二九班', primary: 'hang_pai', role: '组员', extra: [], note: '按要求新增' },

  // 低空视频裁判组
  { name: '成员05', cls: '高一七班', primary: 'di_kong_cai_pan', role: '组员', extra: [], note: '' },
  { name: '成员35', cls: '高一三班', primary: 'di_kong_cai_pan', role: '组员', extra: [], note: '' },

  // 调度剪辑运维组
  { name: '成员04', cls: '高一八班', primary: 'diao_du', role: '组员', extra: [], note: '' },
  { name: '成员12', cls: '高一十三班', primary: 'diao_du', role: '组员', extra: [], note: '' },
  { name: '成员37', cls: '高一四班', primary: 'diao_du', role: '组员', extra: [], note: '' },
  { name: '成员22', cls: '高一七班', primary: 'diao_du', role: '组员', extra: [], note: '' },
];

// 系统账号：username -> 负责的组（groups 为空数组 + admin:true 表示超管）
const ACCOUNTS = [
  { username: 'admin', display: '系统管理员', admin: true, groups: [] },
  { username: 'leader7', display: '成员17（径赛组组长）', admin: false, groups: ['jing_sai'] },
  { username: 'leader6', display: '成员32（田赛组组长）', admin: false, groups: ['tian_sai'] },
  { username: 'leader5', display: '成员44（自由组、摄影组组长）', admin: false, groups: ['zi_you', 'she_ying'] },
  { username: 'leader2', display: '成员45（趣味项目摄像组组长）', admin: false, groups: ['qu_wei'] },
  { username: 'leader4', display: '成员08（地面视频裁判组组长）', admin: false, groups: ['di_mian_cai_pan'] },
  { username: 'leader1', display: '成员23（航拍组组长）', admin: true, groups: ['hang_pai'] },
  { username: 'leader8', display: '成员19（低空视频裁判组组长）', admin: false, groups: ['di_kong_cai_pan'] },
  { username: 'leader3', display: '成员11（调度剪辑运维组组长）', admin: true, groups: ['diao_du'] },
];

// 活动默认日期（可登录后在“设置”里改）
const DEFAULT_DATES = ['2026-09-01', '2026-09-02', '2026-09-03'];

const TITLE = '示例中学新媒体中心示例影像部示例季第01届田径运动会人员考勤表';

module.exports = { GROUPS, MEMBERS, ACCOUNTS, DEFAULT_DATES, TITLE };
