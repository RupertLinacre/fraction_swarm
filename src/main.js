import * as d3 from 'd3'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import './style.css'

const state = {
  numerator: 3,
  denominator: 4,
  total: 40,
  highlightLargest: false,
  showAnswer: false,
  colorWhole: false,
  animationSpeed: 1.33,
}

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="app-shell">
    <header class="question-band" aria-labelledby="app-title">
      <div class="title-block">
        <h1 id="app-title">Fraction swarm</h1>
      </div>

      <div class="summary-strip" aria-live="polite">
        <div class="math-question" id="question"></div>
        <strong id="answer" class="answer-result summary-value is-empty" aria-hidden="true">30 of 40</strong>
        <span id="group-detail" class="group-detail summary-value is-empty" aria-hidden="true"></span>
        <span id="warning" class="warning" hidden></span>
      </div>
    </header>

    <div class="workspace">
      <section class="visual-stage" aria-label="Fraction swarm visualization">
        <svg id="swarm" role="img" aria-labelledby="swarm-title swarm-desc"></svg>
        <h2 id="swarm-title" class="sr-only">Numbered fraction dot swarm</h2>
        <p id="swarm-desc" class="sr-only">Dots are split into denominator groups. Groups in the numerator are shaded.</p>
        <div class="legend" id="legend"></div>
      </section>

      <aside class="control-panel" aria-label="Controls">
        <form class="fraction-form" id="fraction-form">
          <div class="stacked-fraction" aria-label="Fraction">
            <label class="number-field">
              <span>Numerator</span>
              <input id="numerator" name="numerator" type="number" min="0" max="12" value="${state.numerator}" inputmode="numeric" />
            </label>
            <div class="fraction-bar" aria-hidden="true"></div>
            <label class="number-field">
              <span>Denominator</span>
              <input id="denominator" name="denominator" type="number" min="1" max="12" value="${state.denominator}" inputmode="numeric" />
            </label>
          </div>
          <span class="of-word">of</span>
          <label class="number-field total-field">
            <span>Total dots</span>
            <input id="total" name="total" type="number" min="1" max="240" value="${state.total}" inputmode="numeric" />
          </label>
        </form>

        <div class="control-stack">
          <button class="split-button" id="split-button" type="button" aria-pressed="true">Combine</button>
          <label class="highlight-toggle">
            <input id="color-whole" type="checkbox" />
            <span>Colour</span>
          </label>
          <label class="highlight-toggle">
            <input id="show-answer" type="checkbox" />
            <span>Answer</span>
          </label>
          <label class="highlight-toggle">
            <input id="highlight-largest" type="checkbox" />
            <span>Largest</span>
          </label>
          <label class="speed-control">
            <span>Speed</span>
            <input id="animation-speed" type="range" min="0.5" max="2.5" step="0.01" value="${state.animationSpeed}" />
            <output id="speed-output">${state.animationSpeed.toFixed(2)}x</output>
          </label>
        </div>
      </aside>
    </div>
  </main>
`

const svg = d3.select('#swarm')
const visualStage = document.querySelector('.visual-stage')
const form = document.querySelector('#fraction-form')
const inputs = {
  numerator: document.querySelector('#numerator'),
  denominator: document.querySelector('#denominator'),
  total: document.querySelector('#total'),
}
const question = document.querySelector('#question')
const answer = document.querySelector('#answer')
const groupDetail = document.querySelector('#group-detail')
const warning = document.querySelector('#warning')
const legend = document.querySelector('#legend')
const splitButton = document.querySelector('#split-button')
const highlightLargest = document.querySelector('#highlight-largest')
const showAnswer = document.querySelector('#show-answer')
const colorWhole = document.querySelector('#color-whole')
const animationSpeed = document.querySelector('#animation-speed')
const speedOutput = document.querySelector('#speed-output')

let dimensions = { width: 900, height: 560 }
let currentMode = 'grouped'
let stableMode = 'grouped'
let animationTimers = []
let resizeAnimationFrame = 0
let lastResizeKey = ''
const lastPositions = new Map()

const SWARM_TIMING = {
  move: 2600,
  colourLead: 180,
  labelOut: 220,
  labelIn: 440,
  splitLabelInProgress: 0.42,
}

const color = d3.scaleOrdinal()
  .domain(d3.range(12))
  .range(['#16697a', '#db7c26', '#4d7c0f', '#b42357', '#5b5bd6', '#a35d00', '#007f73', '#8a4fff', '#ca6702', '#3c6e71', '#9b2226', '#477998'])

function clampNumber(value, min, max, fallback = min) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function syncInputs(activeInput = null) {
  if (activeInput !== inputs.denominator) inputs.denominator.value = state.denominator
  if (activeInput !== inputs.numerator) inputs.numerator.value = state.numerator
  if (activeInput !== inputs.total) inputs.total.value = state.total
  inputs.numerator.max = state.denominator
  speedOutput.value = `${state.animationSpeed.toFixed(2)}x`
}

function readState({ commitInputs = true, activeInput = null } = {}) {
  const denominator = clampNumber(inputs.denominator.value, 1, 12, state.denominator)
  const total = clampNumber(inputs.total.value, 1, 240, state.total)
  const numerator = clampNumber(inputs.numerator.value, 0, denominator, Math.min(state.numerator, denominator))

  state.denominator = denominator
  state.numerator = numerator
  state.total = total
  state.highlightLargest = highlightLargest.checked
  state.showAnswer = showAnswer.checked
  state.colorWhole = colorWhole.checked
  state.animationSpeed = Number.parseFloat(animationSpeed.value)

  if (commitInputs) {
    syncInputs()
  } else {
    syncInputs(activeInput)
  }
}

function scaledDuration(ms) {
  return ms / state.animationSpeed
}

function updateDimensions(width = visualStage.getBoundingClientRect().width) {
  const safeWidth = Math.max(320, Math.floor(width))
  const denominatorPressure = Math.max(0, state.denominator - 4)
  const heightByWidth = safeWidth * (0.62 + denominatorPressure * 0.018) + 140
  const heightByViewport = window.innerHeight * Math.min(0.86, 0.68 + denominatorPressure * 0.02)
  const height = Math.max(420, Math.floor(Math.min(heightByViewport, heightByWidth)))

  dimensions = { width: safeWidth, height }
}

function getLayoutCenters(denominator, groupSize, dotRadiusValue) {
  const cx = dimensions.width / 2
  const cy = dimensions.height / 2

  if (denominator === 1) {
    return [{ x: cx, y: cy }]
  }

  const denominatorPressure = Math.max(0, denominator - 4)
  const roomScale = Math.min(1.9, 1 + denominatorPressure * 0.095)
  const baseSpread = Math.min(dimensions.width, dimensions.height) * (0.255 + denominatorPressure * 0.009)
  const cloudDiameter = dotRadiusValue * Math.sqrt(groupSize) * 4.15
  const desiredChord = Math.max(92, cloudDiameter + 34)
  const requiredRadius = desiredChord / (2 * Math.sin(Math.PI / denominator))
  const clusterOffsets = getClusterOffsets(groupSize, dotRadiusValue)
  const clusterHalfWidth = (d3.max(clusterOffsets, (offset) => Math.abs(offset.x)) || 0) + dotRadiusValue
  const clusterHalfHeight = (d3.max(clusterOffsets, (offset) => Math.abs(offset.y)) || 0) + dotRadiusValue
  const edgePadding = Math.max(14, dotRadiusValue * 1.2)
  const maxRadiusX = Math.max(0, dimensions.width / 2 - clusterHalfWidth - edgePadding)
  const maxRadiusY = Math.max(0, dimensions.height / 2 - clusterHalfHeight - edgePadding)
  const radiusX = Math.min(maxRadiusX, Math.max(baseSpread * 1.12 * roomScale, requiredRadius))
  const radiusY = Math.min(maxRadiusY, Math.max(baseSpread * 0.9 * roomScale, requiredRadius * 0.82))

  return d3.range(denominator).map((group) => {
    const angle = -Math.PI / 2 + (group / denominator) * Math.PI * 2
    return {
      x: cx + Math.cos(angle) * radiusX,
      y: cy + Math.sin(angle) * radiusY,
    }
  })
}

function createDots() {
  const wholeGroupSize = Math.floor(state.total / state.denominator)
  const hasRemainder = state.total % state.denominator !== 0
  const usableTotal = wholeGroupSize * state.denominator
  const dots = d3.range(usableTotal).map((index) => {
    const group = Math.floor(index / wholeGroupSize)
    const groupIndex = index % wholeGroupSize
    return {
      id: index + 1,
      group,
      groupIndex,
      label: groupIndex + 1,
      totalLabel: index + 1,
      selected: group < state.numerator,
    }
  })

  return { dots, groupSize: wholeGroupSize, usableTotal, hasRemainder }
}

function dotRadius(count, denominator, groupSize) {
  let radius = 17
  if (count > 170) radius = 10
  else if (count > 110) radius = 12
  else if (count > 70) radius = 14

  if (denominator > 1 && groupSize > 1) {
    const edgeReserve = 46
    const centerRadius = Math.max(80, Math.min(dimensions.width, dimensions.height) * 0.43)
    const availableChord = Math.max(46, 2 * centerRadius * Math.sin(Math.PI / denominator) - edgeReserve)
    const clusterDiameterPerRadius = Math.sqrt(groupSize) * 4.15
    const fittedRadius = availableChord / clusterDiameterPerRadius
    radius = Math.min(radius, Math.max(6, fittedRadius))
  }

  return radius
}

function angleFromTop(angle) {
  return (angle + Math.PI * 2.5) % (Math.PI * 2)
}

function rotateOffset(offset, rotation) {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  return {
    x: offset.x * cos - offset.y * sin,
    y: offset.x * sin + offset.y * cos,
  }
}

function getClusterOffsets(count, radius, rotation = 0) {
  const spacing = radius * 2.18
  const offsets = []
  let ring = 0

  while (offsets.length < count) {
    for (let q = -ring; q <= ring; q += 1) {
      const rMin = Math.max(-ring, -q - ring)
      const rMax = Math.min(ring, -q + ring)

      for (let r = rMin; r <= rMax; r += 1) {
        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) !== ring) continue

        const x = spacing * (q + r / 2)
        const y = spacing * (Math.sqrt(3) / 2) * r

        offsets.push({
          x,
          y,
          distance: Math.hypot(x, y),
          angle: Math.atan2(y, x),
        })
      }
    }

    ring += 1
  }

  return offsets
    .sort((a, b) => d3.ascending(a.distance, b.distance) || d3.ascending(angleFromTop(a.angle), angleFromTop(b.angle)))
    .slice(0, count)
    .map((offset) => rotateOffset(offset, rotation))
}

function getPositionCentroid(positions, fallback) {
  if (!positions.length) return fallback

  return {
    x: d3.mean(positions, (position) => position.x) ?? fallback.x,
    y: d3.mean(positions, (position) => position.y) ?? fallback.y,
  }
}

function getPositionExtents(positions, center) {
  return {
    x: d3.max(positions, (position) => Math.abs(position.x - center.x)) || 1,
    y: d3.max(positions, (position) => Math.abs(position.y - center.y)) || 1,
  }
}

function normalizedPosition(position, center, extents) {
  return {
    x: (position.x - center.x) / extents.x,
    y: (position.y - center.y) / extents.y,
  }
}

function assignTargetsByRelativePosition(groupDots, wholeTargets, groupedTargets, fallback) {
  const groupedPositions = groupDots
    .map((dot) => groupedTargets.get(dot.id))
    .filter(Boolean)
  const wholeCenter = getPositionCentroid(wholeTargets, fallback)
  const groupedCenter = getPositionCentroid(groupedPositions, fallback)
  const wholeExtents = getPositionExtents(wholeTargets, wholeCenter)
  const groupedExtents = getPositionExtents(groupedPositions, groupedCenter)
  const candidates = []
  const assignedDots = new Set()
  const assignedTargets = new Set()
  const pairedTargets = new Map()

  groupDots.forEach((dot) => {
    const groupedTarget = groupedTargets.get(dot.id)
    if (!groupedTarget) return

    const groupedPosition = normalizedPosition(groupedTarget, groupedCenter, groupedExtents)

    wholeTargets.forEach((wholeTarget, targetIndex) => {
      const wholePosition = normalizedPosition(wholeTarget, wholeCenter, wholeExtents)
      const dx = groupedPosition.x - wholePosition.x
      const dy = groupedPosition.y - wholePosition.y

      candidates.push({
        dot,
        targetIndex,
        score: dx * dx + dy * dy,
      })
    })
  })

  candidates.sort((a, b) => d3.ascending(a.score, b.score))

  candidates.forEach((candidate) => {
    if (assignedDots.has(candidate.dot.id) || assignedTargets.has(candidate.targetIndex)) return

    assignedDots.add(candidate.dot.id)
    assignedTargets.add(candidate.targetIndex)
    pairedTargets.set(candidate.dot.id, wholeTargets[candidate.targetIndex])
  })

  groupDots.forEach((dot, index) => {
    if (pairedTargets.has(dot.id)) return

    const fallbackIndex = wholeTargets.findIndex((_, targetIndex) => !assignedTargets.has(targetIndex))
    const fallbackTarget = fallbackIndex >= 0 ? wholeTargets[fallbackIndex] : wholeTargets[index] || fallback
    if (fallbackIndex >= 0) assignedTargets.add(fallbackIndex)
    pairedTargets.set(dot.id, fallbackTarget)
  })

  return pairedTargets
}

function getWholeTargets(dots, centers, radius, groupSize, groupedTargets) {
  const center = { x: dimensions.width / 2, y: dimensions.height / 2 }
  const targetPositions = getClusterOffsets(dots.length, radius, 0.18).map((offset, index) => ({
    x: center.x + offset.x,
    y: center.y + offset.y,
    index,
  }))
  const groupDirections = centers.map((groupCenter, group) => {
    const dx = groupCenter.x - center.x
    const dy = groupCenter.y - center.y
    const length = Math.hypot(dx, dy) || 1

    return {
      group,
      x: dx / length,
      y: dy / length,
    }
  })
  const assignedTargets = new Map()
  const assignedPositions = new Set()
  const groupCounts = new Map(d3.range(state.denominator).map((group) => [group, 0]))
  const candidates = []

  groupDirections.forEach((direction) => {
    targetPositions.forEach((target) => {
      candidates.push({
        group: direction.group,
        index: target.index,
        score: (target.x - center.x) * direction.x + (target.y - center.y) * direction.y,
      })
    })
  })

  candidates.sort((a, b) => d3.descending(a.score, b.score))

  candidates.forEach((candidate) => {
    if (assignedPositions.has(candidate.index)) return
    if (groupCounts.get(candidate.group) >= groupSize) return

    assignedPositions.add(candidate.index)
    groupCounts.set(candidate.group, groupCounts.get(candidate.group) + 1)

    if (!assignedTargets.has(candidate.group)) {
      assignedTargets.set(candidate.group, [])
    }

    assignedTargets.get(candidate.group).push(targetPositions[candidate.index])
  })

  const targetMap = new Map()

  d3.range(state.denominator).forEach((group) => {
    const groupDots = dots.filter((dot) => dot.group === group)
    const groupTargets = assignedTargets.get(group) || []
    const pairedTargets = assignTargetsByRelativePosition(groupDots, groupTargets, groupedTargets, center)

    groupDots.forEach((dot) => {
      targetMap.set(dot.id, pairedTargets.get(dot.id) || center)
    })
  })

  return targetMap
}

function getGroupedTargets(dots, centers, radius) {
  const targetMap = new Map()
  const center = { x: dimensions.width / 2, y: dimensions.height / 2 }

  d3.group(dots, (dot) => dot.group).forEach((groupDots, group) => {
    const groupCenter = centers[group] || center
    const rotation = Math.atan2(groupCenter.y - center.y, groupCenter.x - center.x) + 0.22
    const offsets = getClusterOffsets(groupDots.length, radius, rotation)

    groupDots
      .slice()
      .sort((a, b) => d3.ascending(a.groupIndex, b.groupIndex))
      .forEach((dot, index) => {
        const offset = offsets[index] || { x: 0, y: 0 }
        targetMap.set(dot.id, {
          x: groupCenter.x + offset.x,
          y: groupCenter.y + offset.y,
        })
      })
  })

  return targetMap
}

function clearAnimationTimers() {
  animationTimers.forEach((timer) => window.clearTimeout(timer))
  animationTimers = []
  svg.selectAll('g.dot').interrupt('position')
  svg.selectAll('g.dot circle').interrupt('appearance')
  svg.selectAll('g.dot text').interrupt('label')
  splitButton.disabled = false
}

function updateToggleButton() {
  const isSplit = stableMode === 'grouped'
  splitButton.textContent = isSplit ? 'Combine' : 'Split'
  splitButton.setAttribute('aria-pressed', String(isSplit))
}

function renderLegend(groupSize) {
  legend.innerHTML = d3.range(state.denominator).map((group) => {
    const isSelected = group < state.numerator
    return `
      <span class="legend-item ${isSelected ? 'selected' : ''}">
        <span class="legend-swatch" style="--swatch:${isSelected ? color(group) : 'rgba(248, 250, 252, 0.7)'}; --swatch-border:${isSelected ? color(group) : '#cbd5e1'}"></span>
        <span>Group ${group + 1}<span class="legend-count ${state.showAnswer ? '' : 'is-empty'}">: ${groupSize}</span></span>
      </span>
    `
  }).join('')
}

function setSummaryValue(element, text, isVisible) {
  element.textContent = text
  element.classList.toggle('is-empty', !isVisible)
  element.setAttribute('aria-hidden', String(!isVisible))
}

function updateSummary(groupSize, usableTotal, hasRemainder) {
  const selected = groupSize * state.numerator
  katex.render(`\\frac{${state.numerator}}{${state.denominator}} \\times ${usableTotal} = ${state.showAnswer ? selected : '?'}`, question, {
    throwOnError: false,
    displayMode: false,
    output: 'html',
  })
  question.setAttribute('aria-label', `${state.numerator} over ${state.denominator} times ${usableTotal} equals ${state.showAnswer ? selected : 'question mark'}`)
  setSummaryValue(answer, `${selected} of ${usableTotal}`, state.showAnswer)
  setSummaryValue(
    groupDetail,
    `${state.denominator} ${state.denominator === 1 ? 'group' : 'groups'} of ${groupSize} ${groupSize === 1 ? 'dot' : 'dots'}`,
    state.showAnswer,
  )

  if (hasRemainder) {
    warning.hidden = false
    warning.textContent = `${state.total} does not split evenly into ${state.denominator}, so this shows ${usableTotal} dots.`
  } else {
    warning.hidden = true
    warning.textContent = ''
  }
}

function refreshAnswerDisplay() {
  readState()
  const { groupSize, usableTotal, hasRemainder } = createDots()
  updateSummary(groupSize, usableTotal, hasRemainder)
  renderLegend(groupSize)
}

function splitLabelInStart() {
  return SWARM_TIMING.colourLead + SWARM_TIMING.move * SWARM_TIMING.splitLabelInProgress
}

function animationTotalDuration() {
  return SWARM_TIMING.colourLead + SWARM_TIMING.move
}

function combineColourStart() {
  return animationTotalDuration() - SWARM_TIMING.move / 2
}

function combineLabelOutStart() {
  return Math.max(0, animationTotalDuration() - splitLabelInStart() - SWARM_TIMING.labelIn)
}

function isEndpointForMode(mode, dot, groupSize, usableTotal) {
  if (!state.highlightLargest) return false
  return mode === 'whole' ? dot.totalLabel === usableTotal : dot.label === groupSize
}

function groupedCircleFill(dot) {
  return dot.selected ? color(dot.group) : '#f8fafc'
}

function groupedCircleOpacity(dot) {
  return dot.selected ? 1 : 0.5
}

function groupedCircleStroke(dot, isEndpoint) {
  if (isEndpoint) return '#facc15'
  return dot.selected ? d3.color(color(dot.group)).darker(0.45) : '#cbd5e1'
}

function groupedCircleDash(dot, isEndpoint) {
  return dot.selected || isEndpoint ? null : '3 3'
}

function applyCircleEndpoint(circles, mode, groupSize, usableTotal) {
  circles
    .classed('endpoint-dot', (d) => isEndpointForMode(mode, d, groupSize, usableTotal))
    .attr('stroke-width', (d) => isEndpointForMode(mode, d, groupSize, usableTotal) ? 3 : 1.5)
}

function applyGroupedCircles(circles, groupSize, usableTotal) {
  applyCircleEndpoint(circles, 'grouped', groupSize, usableTotal)
  circles
    .attr('fill', groupedCircleFill)
    .attr('fill-opacity', groupedCircleOpacity)
    .attr('stroke', (d) => groupedCircleStroke(d, isEndpointForMode('grouped', d, groupSize, usableTotal)))
    .attr('stroke-dasharray', (d) => groupedCircleDash(d, isEndpointForMode('grouped', d, groupSize, usableTotal)))
}

function applyWholeCircles(circles, groupSize, usableTotal) {
  applyCircleEndpoint(circles, 'whole', groupSize, usableTotal)

  if (state.colorWhole) {
    circles
      .attr('fill', groupedCircleFill)
      .attr('fill-opacity', groupedCircleOpacity)
      .attr('stroke', (d) => groupedCircleStroke(d, isEndpointForMode('whole', d, groupSize, usableTotal)))
      .attr('stroke-dasharray', (d) => groupedCircleDash(d, isEndpointForMode('whole', d, groupSize, usableTotal)))
    return
  }

  circles
    .attr('fill', '#111827')
    .attr('fill-opacity', 1)
    .attr('stroke', (d) => isEndpointForMode('whole', d, groupSize, usableTotal) ? '#facc15' : '#020617')
    .attr('stroke-dasharray', null)
}

function configureGroupedLabels(labels, radius, groupSize, usableTotal) {
  labels
    .text((d) => d.label)
    .classed('endpoint-label', (d) => isEndpointForMode('grouped', d, groupSize, usableTotal))
    .attr('font-weight', (d) => isEndpointForMode('grouped', d, groupSize, usableTotal) ? 950 : 850)
    .attr('font-size', (d) => isEndpointForMode('grouped', d, groupSize, usableTotal) ? Math.max(9, radius * 0.84) : Math.max(8, radius * 0.72))
    .attr('fill', (d) => {
      if (isEndpointForMode('grouped', d, groupSize, usableTotal)) return d.selected ? '#fef3c7' : '#0f172a'
      return d.selected ? '#ffffff' : '#94a3b8'
    })
}

function configureWholeLabels(labels, radius, groupSize, usableTotal) {
  const shouldUseGroupColours = state.colorWhole

  labels
    .text((d) => d.totalLabel)
    .classed('endpoint-label', (d) => isEndpointForMode('whole', d, groupSize, usableTotal))
    .attr('font-weight', (d) => isEndpointForMode('whole', d, groupSize, usableTotal) ? 950 : 850)
    .attr('font-size', (d) => isEndpointForMode('whole', d, groupSize, usableTotal) ? Math.max(8, radius * 0.74) : Math.max(7, radius * 0.62))
    .attr('fill', (d) => {
      if (isEndpointForMode('whole', d, groupSize, usableTotal)) return d.selected || !shouldUseGroupColours ? '#fef3c7' : '#0f172a'
      if (!shouldUseGroupColours) return '#ffffff'
      return d.selected ? '#ffffff' : '#94a3b8'
    })
}

function transitionGroupedCircles(circles, groupSize, usableTotal, delay, duration) {
  applyCircleEndpoint(circles, 'grouped', groupSize, usableTotal)
  circles
    .transition('appearance')
    .delay(scaledDuration(delay))
    .duration(scaledDuration(duration))
    .ease(d3.easeCubicOut)
    .attr('fill', groupedCircleFill)
    .attr('fill-opacity', groupedCircleOpacity)
    .attr('stroke', (d) => groupedCircleStroke(d, isEndpointForMode('grouped', d, groupSize, usableTotal)))
    .attr('stroke-dasharray', (d) => groupedCircleDash(d, isEndpointForMode('grouped', d, groupSize, usableTotal)))
}

function transitionWholeCircles(circles, groupSize, usableTotal, delay, duration) {
  applyCircleEndpoint(circles, 'whole', groupSize, usableTotal)
  const wholeTransition = circles
    .transition('appearance')
    .delay(scaledDuration(delay))
    .duration(scaledDuration(duration))
    .ease(d3.easeCubicInOut)

  if (state.colorWhole) {
    wholeTransition
      .attr('fill', groupedCircleFill)
      .attr('fill-opacity', groupedCircleOpacity)
      .attr('stroke', (d) => groupedCircleStroke(d, isEndpointForMode('whole', d, groupSize, usableTotal)))
      .attr('stroke-dasharray', (d) => groupedCircleDash(d, isEndpointForMode('whole', d, groupSize, usableTotal)))
    return
  }

  wholeTransition
    .attr('fill', '#111827')
    .attr('fill-opacity', 1)
    .attr('stroke', (d) => isEndpointForMode('whole', d, groupSize, usableTotal) ? '#facc15' : '#020617')
    .attr('stroke-dasharray', null)
}

function setNodePositions(node, targets, center) {
  node.attr('transform', (d) => {
    const target = targets.get(d.id) || center
    d.x = target.x
    d.y = target.y
    lastPositions.set(d.id, { x: target.x, y: target.y })
    return `translate(${target.x},${target.y})`
  })
}

function smoothProgress(value) {
  const t = Math.min(1, Math.max(0, value))
  return t * t * (3 - 2 * t)
}

function createMotionPlan(dots, groupedTargets, wholeTargets, centers, center) {
  const wholeCenters = new Map()

  d3.group(dots, (dot) => dot.group).forEach((groupDots, group) => {
    const positions = groupDots
      .map((dot) => wholeTargets.get(dot.id))
      .filter(Boolean)

    wholeCenters.set(group, getPositionCentroid(positions, center))
  })

  return new Map(dots.map((dot) => {
    const splitCenter = centers[dot.group] || center
    const wholeCenter = wholeCenters.get(dot.group) || center
    const groupedTarget = groupedTargets.get(dot.id) || splitCenter
    const wholeTarget = wholeTargets.get(dot.id) || wholeCenter

    return [dot.id, {
      splitCenter,
      wholeCenter,
      splitLocal: {
        x: groupedTarget.x - splitCenter.x,
        y: groupedTarget.y - splitCenter.y,
      },
      wholeLocal: {
        x: wholeTarget.x - wholeCenter.x,
        y: wholeTarget.y - wholeCenter.y,
      },
    }]
  }))
}

function motionPlanPosition(dot, progress, plan, mode, fallbackTarget) {
  const entry = plan?.get(dot.id)
  if (!entry) return fallbackTarget

  const isCombining = mode === 'combine'
  const centerStart = isCombining ? entry.splitCenter : entry.wholeCenter
  const centerEnd = isCombining ? entry.wholeCenter : entry.splitCenter
  const localStart = isCombining ? entry.splitLocal : entry.wholeLocal
  const localEnd = isCombining ? entry.wholeLocal : entry.splitLocal
  const centerProgress = smoothProgress(progress)
  const localProgress = smoothProgress((progress - 0.12) / 0.78)

  return {
    x: d3.interpolateNumber(centerStart.x, centerEnd.x)(centerProgress) + d3.interpolateNumber(localStart.x, localEnd.x)(localProgress),
    y: d3.interpolateNumber(centerStart.y, centerEnd.y)(centerProgress) + d3.interpolateNumber(localStart.y, localEnd.y)(localProgress),
  }
}

function transitionNodePositions(node, targets, delay, duration, center, motionPlan = null, motionMode = null) {
  if (motionPlan) {
    const movingDots = node.data()
    let ownsTween = false

    node
      .transition('position')
      .delay(scaledDuration(delay))
      .duration(scaledDuration(duration))
      .ease(d3.easeCubicInOut)
      .tween('position', function () {
        if (ownsTween) return null
        ownsTween = true

        return (t) => {
          const positions = new Map()

          movingDots.forEach((dot) => {
            positions.set(dot.id, motionPlanPosition(dot, t, motionPlan, motionMode, targets.get(dot.id) || center))
          })

          node.attr('transform', (dot) => {
            const position = positions.get(dot.id) || targets.get(dot.id) || center
            dot.x = position.x
            dot.y = position.y
            lastPositions.set(dot.id, { x: position.x, y: position.y })
            return `translate(${position.x},${position.y})`
          })
        }
      })

    return
  }

  node
    .transition('position')
    .delay(scaledDuration(delay))
    .duration(scaledDuration(duration))
    .ease(d3.easeCubicInOut)
    .attrTween('transform', (d) => {
      const start = lastPositions.get(d.id) || { x: d.x ?? center.x, y: d.y ?? center.y }
      const target = targets.get(d.id) || center
      const interpolateX = d3.interpolateNumber(start.x, target.x)
      const interpolateY = d3.interpolateNumber(start.y, target.y)

      return (t) => {
        const planned = motionPlanPosition(d, t, motionPlan, motionMode, target)
        const x = motionPlan ? planned.x : interpolateX(t)
        const y = motionPlan ? planned.y : interpolateY(t)
        d.x = x
        d.y = y
        lastPositions.set(d.id, { x, y })
        return `translate(${x},${y})`
      }
    })
}

function interruptNodeTransitions(node) {
  node.interrupt('position')
  node.select('circle').interrupt('appearance')
  node.select('text').interrupt('label')
}

function styleStableNodes(node, radius, mode, groupSize, usableTotal) {
  const circles = node.select('circle')
  const labels = node.select('text')

  if (mode === 'whole') {
    applyWholeCircles(circles, groupSize, usableTotal)
    configureWholeLabels(labels, radius, groupSize, usableTotal)
  } else {
    applyGroupedCircles(circles, groupSize, usableTotal)
    configureGroupedLabels(labels, radius, groupSize, usableTotal)
  }

  labels.attr('opacity', 1)
}

function animateSplit(node, radius, groupedTargets, center, groupSize, usableTotal, motionPlan) {
  const circles = node.select('circle')
  const labels = node.select('text')
  const labelInStart = splitLabelInStart()

  transitionGroupedCircles(circles, groupSize, usableTotal, 0, SWARM_TIMING.move / 2)

  labels
    .transition('label')
    .duration(scaledDuration(SWARM_TIMING.labelOut))
    .ease(d3.easeCubicOut)
    .attr('opacity', 0)
    .on('end', function () {
      configureGroupedLabels(d3.select(this), radius, groupSize, usableTotal)
    })
    .transition()
    .delay(scaledDuration(Math.max(0, labelInStart - SWARM_TIMING.labelOut)))
    .duration(scaledDuration(SWARM_TIMING.labelIn))
    .ease(d3.easeCubicOut)
    .attr('opacity', 1)

  transitionNodePositions(node, groupedTargets, SWARM_TIMING.colourLead, SWARM_TIMING.move, center, motionPlan, 'split')
}

function animateCombine(node, radius, wholeTargets, center, groupSize, usableTotal, motionPlan) {
  const circles = node.select('circle')
  const labels = node.select('text')
  const labelOutStart = combineLabelOutStart()
  const labelInStart = animationTotalDuration() - SWARM_TIMING.labelOut
  const labelInDelay = Math.max(0, labelInStart - labelOutStart - SWARM_TIMING.labelIn)

  transitionWholeCircles(circles, groupSize, usableTotal, combineColourStart(), SWARM_TIMING.move / 2)

  labels
    .transition('label')
    .delay(scaledDuration(labelOutStart))
    .duration(scaledDuration(SWARM_TIMING.labelIn))
    .ease(d3.easeCubicInOut)
    .attr('opacity', 0)
    .on('end', function () {
      configureWholeLabels(d3.select(this), radius, groupSize, usableTotal)
    })
    .transition()
    .delay(scaledDuration(labelInDelay))
    .duration(scaledDuration(SWARM_TIMING.labelOut))
    .ease(d3.easeCubicOut)
    .attr('opacity', 1)

  transitionNodePositions(node, wholeTargets, 0, SWARM_TIMING.move, center, motionPlan, 'combine')
}

function render(mode = currentMode, options = {}) {
  readState(options)
  const { dots, groupSize, usableTotal, hasRemainder } = createDots()
  const center = { x: dimensions.width / 2, y: dimensions.height / 2 }
  const radius = dotRadius(dots.length, state.denominator, groupSize)
  const centers = getLayoutCenters(state.denominator, groupSize, radius)
  const groupedTargets = getGroupedTargets(dots, centers, radius)
  const wholeTargets = getWholeTargets(dots, centers, radius, groupSize, groupedTargets)
  const motionPlan = createMotionPlan(dots, groupedTargets, wholeTargets, centers, center)
  currentMode = mode
  if (mode === 'whole' || mode === 'grouped') {
    stableMode = mode
    updateToggleButton()
  }

  updateSummary(groupSize, usableTotal, hasRemainder)
  renderLegend(groupSize)

  svg
    .attr('viewBox', `0 0 ${dimensions.width} ${dimensions.height}`)
    .attr('width', dimensions.width)
    .attr('height', dimensions.height)
    .style('height', `${dimensions.height}px`)

  visualStage.style.minHeight = `${dimensions.height + 86}px`

  const node = svg.selectAll('g.dot')
    .data(dots, (d) => d.id)
    .join(
      (enter) => {
        const group = enter.append('g')
          .attr('class', 'dot')
          .attr('transform', `translate(${dimensions.width / 2},${dimensions.height / 2})`)

        group.append('circle')
        group.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')

        return group
      },
      (update) => update,
      (exit) => exit.remove(),
    )

  interruptNodeTransitions(node)

  dots.forEach((dot) => {
    const previous = lastPositions.get(dot.id)
    const sourceTargets = mode === 'grouping'
      ? wholeTargets
      : mode === 'combining'
        ? groupedTargets
        : mode === 'whole'
          ? wholeTargets
          : groupedTargets
    const source = sourceTargets.get(dot.id) || center

    if (previous) {
      dot.x = previous.x
      dot.y = previous.y
    } else {
      dot.x = source.x
      dot.y = source.y
    }
  })

  node.attr('transform', (d) => `translate(${d.x},${d.y})`)

  node.select('circle')
    .attr('r', radius)

  if (mode === 'grouping') {
    animateSplit(node, radius, groupedTargets, center, groupSize, usableTotal, motionPlan)
    return
  }

  if (mode === 'combining') {
    animateCombine(node, radius, wholeTargets, center, groupSize, usableTotal, motionPlan)
    return
  }

  styleStableNodes(node, radius, mode, groupSize, usableTotal)
  setNodePositions(node, mode === 'whole' ? wholeTargets : groupedTargets, center)
}

function toggleSplit() {
  clearAnimationTimers()
  splitButton.disabled = true

  if (stableMode === 'grouped') {
    render('combining')

    animationTimers.push(window.setTimeout(() => {
      render('whole')
      splitButton.disabled = false
    }, scaledDuration(animationTotalDuration())))
    return
  }

  render('grouping')

  animationTimers.push(window.setTimeout(() => {
    render('grouped')
    splitButton.disabled = false
  }, scaledDuration(animationTotalDuration())))
}

function scheduleResize(width = visualStage.getBoundingClientRect().width) {
  const safeWidth = Math.max(320, Math.floor(width))
  const resizeKey = `${safeWidth}:${Math.floor(window.innerHeight)}`

  if (resizeKey === lastResizeKey) return
  lastResizeKey = resizeKey

  if (resizeAnimationFrame) {
    window.cancelAnimationFrame(resizeAnimationFrame)
  }

  resizeAnimationFrame = window.requestAnimationFrame(() => {
    resizeAnimationFrame = 0
    readState()
    updateDimensions(safeWidth)
    render()
  })
}

const resizeObserver = new ResizeObserver(([entry]) => {
  scheduleResize(entry.contentRect.width)
})

form.addEventListener('input', () => {
  clearAnimationTimers()
  readState({ commitInputs: false, activeInput: document.activeElement })
  updateDimensions()
  render('grouped', { commitInputs: false, activeInput: document.activeElement })
})
Object.values(inputs).forEach((input) => {
  input.addEventListener('blur', () => {
    readState()
    updateDimensions()
    render('grouped')
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      input.blur()
    }

    if (event.key === 'Escape') {
      syncInputs()
      input.blur()
    }
  })
})
splitButton.addEventListener('click', toggleSplit)
highlightLargest.addEventListener('change', () => {
  render(currentMode)
})
showAnswer.addEventListener('change', () => {
  refreshAnswerDisplay()
})
colorWhole.addEventListener('change', () => {
  render(currentMode)
})
animationSpeed.addEventListener('input', () => {
  state.animationSpeed = Number.parseFloat(animationSpeed.value)
  speedOutput.value = `${state.animationSpeed.toFixed(2)}x`
})
window.addEventListener('resize', () => {
  scheduleResize()
})
resizeObserver.observe(visualStage)
render()
