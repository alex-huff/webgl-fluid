import fs from 'node:fs'
import spawn from 'cross-spawn'
import { cyan } from 'kolorist'
import prompts from 'prompts'
import * as semver from 'semver'

const docsPath = ['./README.md']

async function release() {
  console.log(cyan('\nFetching origin...'))
  if (spawn.sync('git', ['pull'], { stdio: 'inherit' }).status === 1) {
    return
  }

  console.log(cyan('\nLinting staged...'))
  if (spawn.sync('npx', ['lint-staged'], { stdio: 'inherit' }).status === 1) {
    return
  }

  console.log(cyan('\nBuilding...'))
  if (spawn.sync('pnpm', ['build'], { stdio: 'inherit' }).status === 1) {
    return
  }

  console.log(cyan('\nPublinting...'))
  if (spawn.sync('npx', ['publint'], { stdio: 'inherit' }).status === 1) {
    return
  }

  const npmConfig = JSON.parse(fs.readFileSync('./package.json', 'utf-8'))
  const { name, version: currentVersion } = npmConfig

  const choices = Array.from(['patch', 'minor', 'major', 'prerelease', 'prepatch', 'preminor', 'premajor', 'custom'], title => ({
    title,
    value: title,
  }))

  const { releaseType } = (await prompts({
    type: 'select',
    name: 'releaseType',
    message: 'Select release type',
    choices,
  }))

  const parsedCurrentVersion = semver.parse(currentVersion)
  let targetVersion

  if (['patch', 'minor', 'major'].includes(releaseType)) {
    targetVersion = semver.inc(currentVersion, releaseType)
  }
  else if (releaseType.startsWith('pre')) {
    // 只升 prerelease 版本时，已经是 beta 阶段就不可能再回到 alpha 阶段
    let prereleaseTypes = ['alpha', 'beta', 'rc']
    if (releaseType === 'prerelease') {
      const i = prereleaseTypes.indexOf(String(parsedCurrentVersion?.prerelease[0]))
      if (i !== -1) {
        prereleaseTypes = prereleaseTypes.slice(i)
      }
    }

    targetVersion = prereleaseTypes.length === 1
      // 已经是 rc 阶段就不用选了
      ? semver.inc(currentVersion, releaseType, prereleaseTypes[0])
      : (await prompts({
          type: 'select',
          name: 'value',
          message: 'Select prerelease type',
          choices: Array.from(prereleaseTypes, title => ({
            title,
            value: semver.inc(currentVersion, releaseType, title),
          })),
        })).value
  }
  else {
    targetVersion = (await prompts({
      type: 'text',
      name: 'value',
      message: 'Input custom version',
    })).value
  }

  if (!semver.valid(targetVersion)) {
    throw new Error(`invalid target version: ${targetVersion}`)
  }

  const { yes } = await prompts({
    type: 'confirm',
    name: 'yes',
    message: `Releasing v${targetVersion}. Confirm?`,
  })

  if (!yes) {
    return
  }

  if (['minor', 'major'].includes(releaseType)) {
    const parsedTargetVersion = semver.parse(targetVersion)
    if (parsedCurrentVersion && parsedTargetVersion) {
      const pattern = new RegExp(`${name}@${parsedCurrentVersion.major}.${parsedCurrentVersion.minor}`, 'g')
      const replacement = `${name}@${parsedTargetVersion.major}.${parsedTargetVersion.minor}`
      docsPath.forEach((docPath) => {
        fs.writeFileSync(docPath, fs.readFileSync(docPath, 'utf-8').replace(pattern, replacement))
      })
    }
  }

  npmConfig.version = targetVersion
  fs.writeFileSync('./package.json', JSON.stringify(npmConfig, null, 2))

  console.log(cyan('\nCommitting...'))
  if (spawn.sync('git', ['add', '-A'], { stdio: 'inherit' }).status === 1) {
    return
  }
  if (spawn.sync('git', ['commit', '-m', `release: v${targetVersion}`], { stdio: 'inherit' }).status === 1) {
    // pre-commit 时如果 lint 失败，则恢复版本号
    npmConfig.version = currentVersion
    fs.writeFileSync('./package.json', JSON.stringify(npmConfig, null, 2))
    return
  }

  console.log(cyan('\nPushing...'))
  if (spawn.sync('git', ['push'], { stdio: 'inherit' }).status === 1) {
    return
  }
  if (spawn.sync('git', ['tag', `v${targetVersion}`], { stdio: 'inherit' }).status === 1) {
    return
  }
  if (spawn.sync('git', ['push', 'origin', `refs/tags/v${targetVersion}`], { stdio: 'inherit' }).status === 1) {
    return
  }

  console.log(cyan('\nPublishing to npm...'))
  if (spawn.sync('npm', ['publish', '--registry=https://registry.npmjs.org'], { stdio: 'inherit' }).status === 1) {
    return
  }

  console.log(cyan('\nSync to cnpm...'))
  spawn.sync('pnpm', ['sync-to-cnpm'], { stdio: 'inherit' })
}

try {
  release()
}
catch (e) {
  console.error(e)
}
