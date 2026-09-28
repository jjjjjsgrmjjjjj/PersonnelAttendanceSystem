'use strict';
/**
 * 权限判定（三种角色）
 *
 *   管理员    is_admin=1                        ：可填报全部 + 管理设置/账号 + 导出
 *   成员11账号  can_view_all=1（且非管理员）       ：可查看全部 + 导出，**不能填报**
 *   组长      user_groups 绑定若干组             ：只能查看/填报自己负责的组
 *
 * 关键点：成员11账号不绑定任何分组，因此 editableGroupIds / canEditMember 天然为空/否，
 * 写权限由 attendance.applyChanges 与服务端路由双重拦截。
 */

function isAdmin(user) {
  return !!(user && user.is_admin);
}

/** 成员11全组账号（成员22会一类）：能看全部、能导出，不能改 */
function canViewAll(user) {
  return !!(user && user.can_view_all);
}

/** 该用户可编辑的分组 id 集合 */
function editableGroupIds(user) {
  if (!user) return new Set();
  if (isAdmin(user)) return new Set(['*']);
  return new Set((user.groups || []).map((g) => g.id));
}

/** 用户是否可编辑某个成员（成员所属的任一分组在其职责范围内） */
function canEditMember(user, member) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const owned = new Set((user.groups || []).map((g) => g.id));
  return (member.groupIds || []).some((gid) => owned.has(gid));
}

/** 用户是否可查看某个成员（管理员与成员11账号可看全部） */
function canViewMember(user, member) {
  if (!user) return false;
  if (isAdmin(user) || canViewAll(user)) return true;
  const owned = new Set((user.groups || []).map((g) => g.id));
  return (member.groupIds || []).some((gid) => owned.has(gid));
}

/** 用户是否可导出表格（管理员 + 成员11账号） */
function canExport(user) {
  return isAdmin(user) || canViewAll(user);
}

module.exports = { isAdmin, canViewAll, editableGroupIds, canEditMember, canViewMember, canExport };
