'use strict';
/** 权限判定：管理员可操作全部；组长只能操作自己负责的组 */

function isAdmin(user) {
  return !!(user && user.is_admin);
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

/** 用户是否可查看某个成员 */
function canViewMember(user, member) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const owned = new Set((user.groups || []).map((g) => g.id));
  return (member.groupIds || []).some((gid) => owned.has(gid));
}

module.exports = { isAdmin, editableGroupIds, canEditMember, canViewMember };
