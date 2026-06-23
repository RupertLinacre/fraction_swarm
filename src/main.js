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
  wholeLayout: 'blob',
}

const app = document.querySelector('#app')

app.innerHTML = `
  <main class="app-shell">
    <section class="control-band" aria-labelledby="app-title">
      <div class="title-block">
        <p class="eyebrow">Fraction swarm</p>
        <h1 id="app-title">See a fraction split into equal moving groups.</h1>
      </div>

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

      <div class="summary-strip" aria-live="polite">
        <div class="math-question" id="question"></div>
        <strong id="answer" class="answer-result" hidden>30 of 40</strong>
        <span id="group-detail"></span>
        <button class="split-button" id="split-button" type="button" aria-pressed="true">Combine</button>
        <label class="highlight-toggle">
          <input id="rectangle-layout" type="checkbox" />
          <span>Rectangle whole</span>
        </label>
        <label class="highlight-toggle">
          <input id="show-answer" type="checkbox" />
          <span>Show answer</span>
        </label>
        <label class="highlight-toggle">
          <input id="highlight-largest" type="checkbox" />
          <span>Highlight largest</span>
        </label>
        <span id="warning" class="warning" hidden></span>
      </div>
    </section>

    <section class="visual-stage" aria-label="Fraction swarm visualization">
      <svg id="swarm" role="img" aria-labelledby="swarm-title swarm-desc"></svg>
      <h2 id="swarm-title" class="sr-only">Numbered fraction dot swarm</h2>
      <p id="swarm-desc" class="sr-only">Dots are split into denominator groups. Groups in the numerator are shaded.</p>
      <div class="legend" id="legend"></div>
    </section>
  </main>
`

const svg = d3.select('#swarm')
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
const rectangleLayout = document.querySelector('#rectangle-layout')

let dimensions = { width: 900, height: 560 }
let simulation
let currentMode = 'grouped'
let stableMode = 'grouped'
let animationTimers = []
const lastPositions = new Map()

const color = d3.scaleOrdinal()
  .domain(d3.range(12))
  .range(['#16697a', '#db7c26', '#4d7c0f', '#b42357', '#5b5bd6', '#a35d00', '#007f73', '#8a4fff', '#ca6702', '#3c6e71', '#9b2226', '#477998'])

function clampNumber(value, min, max) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return min
  return Math.min(Math.max(parsed, min), max)
}

function readState() {
  const denominator = clampNumber(inputs.denominator.value, 1, 12)
  const total = clampNumber(inputs.total.value, 1, 240)
  const numerator = clampNumber(inputs.numerator.value, 0, denominator)

  state.denominator = denominator
  state.numerator = numerator
  state.total = total
  state.highlightLargest = highlightLargest.checked
  state.showAnswer = showAnswer.checked
  state.wholeLayout = rectangleLayout.checked ? 'rectangle' : 'blob'

  inputs.denominator.value = denominator
  inputs.numerator.max = denominator
  inputs.numerator.value = numerator
  inputs.total.value = total
}

function getLayoutCenters(denominator) {
  const cx = dimensions.width / 2
  const cy = dimensions.height / 2
  const spread = Math.min(dimensions.width, dimensions.height) * 0.26
  const radiusX = Math.max(spread * 1.12, 84)
  const radiusY = Math.max(spread * 0.86, 76)

  if (denominator === 1) {
    return [{ x: cx, y: cy }]
  }

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

function dotRadius(count) {
  if (count > 170) return 10
  if (count > 110) return 12
  if (count > 70) return 14
  return 17
}

function rectangleMetrics(groupSize) {
  const columns = state.denominator
  const rows = groupSize
  const usableWidth = dimensions.width * 0.7
  const usableHeight = dimensions.height * 0.74
  const spacingX = columns > 1 ? Math.min(130, usableWidth / (columns - 1)) : 0
  const spacingY = rows > 1 ? Math.min(28, usableHeight / (rows - 1)) : 0
  const spacingForRadius = Math.max(12, Math.min(spacingX || 28, spacingY || 28))
  const width = (columns - 1) * spacingX
  const height = (rows - 1) * spacingY

  return {
    left: dimensions.width / 2 - width / 2,
    top: dimensions.height / 2 - height / 2,
    spacingX,
    spacingY,
    radius: Math.max(6, Math.min(dotRadius(state.denominator * groupSize), spacingForRadius * 0.43)),
  }
}

function wholeTarget(dot, groupSize) {
  if (state.wholeLayout !== 'rectangle') {
    return {
      x: dimensions.width / 2,
      y: dimensions.height / 2,
    }
  }

  const metrics = rectangleMetrics(groupSize)
  return {
    x: metrics.left + dot.group * metrics.spacingX,
    y: metrics.top + dot.groupIndex * metrics.spacingY,
  }
}

function renderRadius(count, mode, groupSize) {
  if (mode === 'whole' && state.wholeLayout === 'rectangle') {
    return rectangleMetrics(groupSize).radius
  }

  return dotRadius(count)
}

function clearAnimationTimers() {
  animationTimers.forEach((timer) => window.clearTimeout(timer))
  animationTimers = []
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
        Group ${group + 1}${state.showAnswer ? `: ${groupSize}` : ''}
      </span>
    `
  }).join('')
}

function updateSummary(groupSize, usableTotal, hasRemainder) {
  const selected = groupSize * state.numerator
  katex.render(`\\frac{${state.numerator}}{${state.denominator}} \\times ${usableTotal} = ${state.showAnswer ? selected : '?'}`, question, {
    throwOnError: false,
    displayMode: false,
    output: 'html',
  })
  question.setAttribute('aria-label', `${state.numerator} over ${state.denominator} times ${usableTotal} equals ${state.showAnswer ? selected : 'question mark'}`)
  answer.textContent = state.showAnswer ? `${selected} of ${usableTotal}` : ''
  answer.hidden = !state.showAnswer
  groupDetail.textContent = state.showAnswer
    ? `${state.denominator} ${state.denominator === 1 ? 'group' : 'groups'} of ${groupSize} ${groupSize === 1 ? 'dot' : 'dots'}`
    : ''

  if (hasRemainder) {
    warning.hidden = false
    warning.textContent = `${state.total} does not split evenly into ${state.denominator}, so this shows ${usableTotal} dots.`
  } else {
    warning.hidden = true
    warning.textContent = ''
  }
}

function styleNodes(node, radius, mode, groupSize, usableTotal) {
  const circles = node.select('circle')
  const labels = node.select('text')
  const isEndpoint = (d) => state.highlightLargest && (mode === 'whole' ? d.totalLabel === usableTotal : d.label === groupSize)

  circles
    .classed('endpoint-dot', isEndpoint)
    .attr('stroke-width', (d) => isEndpoint(d) ? 3 : 1.5)

  labels
    .classed('endpoint-label', isEndpoint)
    .attr('font-weight', (d) => isEndpoint(d) ? 950 : 850)

  if (mode === 'whole') {
    circles
      .interrupt()
      .attr('fill', '#111827')
      .attr('fill-opacity', 1)
      .attr('stroke', (d) => isEndpoint(d) ? '#facc15' : '#020617')
      .attr('stroke-dasharray', null)

    labels
      .interrupt()
      .text((d) => d.totalLabel)
      .attr('font-size', (d) => isEndpoint(d) ? Math.max(8, radius * 0.74) : Math.max(7, radius * 0.62))
      .attr('fill', (d) => isEndpoint(d) ? '#fef3c7' : '#ffffff')
      .attr('opacity', 1)
    return
  }

  circles
    .transition()
    .duration(420)
    .attr('fill', (d) => d.selected ? color(d.group) : '#f8fafc')
    .attr('fill-opacity', (d) => d.selected ? 1 : 0.5)
    .attr('stroke', (d) => {
      if (isEndpoint(d)) return '#facc15'
      return d.selected ? d3.color(color(d.group)).darker(0.45) : '#cbd5e1'
    })
    .attr('stroke-dasharray', (d) => d.selected || isEndpoint(d) ? null : '3 3')

  if (mode === 'grouping') {
    labels
      .interrupt()
      .transition()
      .duration(160)
      .attr('opacity', 0)
    return
  }

  labels
    .interrupt()
    .text((d) => d.label)
    .attr('font-size', (d) => isEndpoint(d) ? Math.max(9, radius * 0.84) : Math.max(8, radius * 0.72))
    .attr('fill', (d) => {
      if (isEndpoint(d)) return d.selected ? '#fef3c7' : '#0f172a'
      return d.selected ? '#ffffff' : '#94a3b8'
    })
    .transition()
    .duration(280)
    .attr('opacity', 1)
}

function render(mode = currentMode) {
  readState()
  const { dots, groupSize, usableTotal, hasRemainder } = createDots()
  const centers = getLayoutCenters(state.denominator)
  const center = { x: dimensions.width / 2, y: dimensions.height / 2 }
  const radius = renderRadius(dots.length, mode, groupSize)
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

  if (simulation) simulation.stop()

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

  dots.forEach((dot) => {
    const previous = lastPositions.get(dot.id)
    if (previous) {
      dot.x = previous.x
      dot.y = previous.y
    } else {
      dot.x = center.x + (Math.random() - 0.5) * 40
      dot.y = center.y + (Math.random() - 0.5) * 40
    }
  })

  node.select('circle')
    .attr('r', radius)

  styleNodes(node, radius, mode, groupSize, usableTotal)

  simulation = d3.forceSimulation(dots)
    .force('x', d3.forceX((d) => mode === 'whole' ? wholeTarget(d, groupSize).x : centers[d.group].x).strength(mode === 'whole' && state.wholeLayout === 'rectangle' ? 0.46 : mode === 'whole' ? 0.17 : 0.19))
    .force('y', d3.forceY((d) => mode === 'whole' ? wholeTarget(d, groupSize).y : centers[d.group].y).strength(mode === 'whole' && state.wholeLayout === 'rectangle' ? 0.46 : mode === 'whole' ? 0.17 : 0.19))
    .force('charge', d3.forceManyBody().strength(mode === 'whole' && state.wholeLayout === 'rectangle' ? 0 : mode === 'whole' ? -7 : -9))
    .force('collide', d3.forceCollide(radius + (mode === 'whole' && state.wholeLayout === 'rectangle' ? 0.2 : 0.8)).iterations(3))
    .alpha(0.95)
    .alphaDecay(0.033)
    .on('tick', () => {
      node.attr('transform', (d) => {
        lastPositions.set(d.id, { x: d.x, y: d.y })
        return `translate(${d.x},${d.y})`
      })
    })
}

function toggleSplit() {
  clearAnimationTimers()

  if (stableMode === 'grouped') {
    render('whole')
    return
  }

  splitButton.disabled = true
  render('grouping')

  animationTimers.push(window.setTimeout(() => {
    render('grouped')
    splitButton.disabled = false
  }, 850))
}

const resizeObserver = new ResizeObserver(([entry]) => {
  const width = Math.max(320, Math.floor(entry.contentRect.width))
  const height = Math.max(420, Math.floor(Math.min(window.innerHeight * 0.68, width * 0.68 + 140)))
  dimensions = { width, height }
  render()
})

form.addEventListener('input', () => {
  clearAnimationTimers()
  render('grouped')
})
splitButton.addEventListener('click', toggleSplit)
highlightLargest.addEventListener('change', () => {
  render(currentMode)
})
showAnswer.addEventListener('change', () => {
  render(currentMode)
})
rectangleLayout.addEventListener('change', () => {
  render(currentMode)
})
resizeObserver.observe(document.querySelector('.visual-stage'))
render()
