import { DefaultResourceLoader, getAgentDir, loadSkills } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getRemovableSkillEntry } from "@/lib/skill-delete";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";
import { resolveScopedResources } from "@/lib/project-resource-overrides";
import { realPathOrSelf as canonical } from "@/lib/worktree";

/**
 * Every skill configured for this cwd, loaded or not: the Skills page must still list a
 * skill that is switched off (globally or in this project) so it can be switched on again.
 * The loader discovers file/package skills without binding a session; extension
 * resources_discover handlers only run after session_start, not during this listing.
 * Every skill carries its owner's source info: a project entry that re-enables an inherited
 * skill (a package `autoload: false` delta or a top-level `+path`) makes pi report project
 * scope and the project-relative source, which would split one package into two groups.
 */
export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true });
  await loader.reload(projectTrustReloadOptions(cwd, agentDir));
  const { skills: loaded, diagnostics } = loader.getSkills();
  const scoped = (await resolveScopedResources(cwd, agentDir)).resources.filter((r) => r.type === "skills");
  const byPath = new Map(scoped.map((r) => [canonical(r.path), r]));
  const loadedPaths = new Set(loaded.map((skill) => canonical(skill.filePath)));
  const off = scoped.filter((r) => !loadedPaths.has(canonical(r.path)));
  const unloaded = off.length === 0 ? [] : loadSkills({
    cwd,
    agentDir,
    skillPaths: off.map((r) => r.path),
    includeDefaults: false,
  }).skills;
  const skills: SkillInfo[] = [...loaded, ...unloaded].map((skill) => {
    const scopedSkill = byPath.get(canonical(skill.filePath));
    const owner = scopedSkill?.owner;
    return {
      ...skill,
      ...(owner && { sourceInfo: { ...skill.sourceInfo, ...owner, path: skill.filePath } }),
      enabled: loadedPaths.has(canonical(skill.filePath)),
      globalEnabled: scopedSkill ? scopedSkill.globalEnabled : null,
      removable: getRemovableSkillEntry(skill.filePath, cwd, agentDir) !== null,
      projectOverride: scopedSkill?.override,
    };
  });
  return {
    skills: annotateSkillsWithInstallInfo(skills, { cwd, agentDir }),
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}
