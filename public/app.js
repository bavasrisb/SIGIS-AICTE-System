// SIGIS Frontend Application Logic (SIH 2026 - SIH26264)

let currentStats = null;
let currentComplaints = [];
let currentInstitutions = [];
let currentOverlaps = [];
let currentReports = null;
let activeReviewPair = null;

let bureauChartInstance = null;
let categoryChartInstance = null;

// Stage 1-4 State
let currentUser = null;
let eventSource = null;
let activeDrawerComplaintId = null;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  
  // Authenticate and establish real-time stream
  await initAuth();
  
  // Set default target date in Add Modal to 30 days from now
  const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const targetDateInput = document.getElementById('addTargetDate');
  if (targetDateInput) targetDateInput.value = thirtyDaysOut;

  // Setup search & filter listeners
  const searchInput = document.getElementById('filterSearch');
  if (searchInput) searchInput.addEventListener('input', debounce(applyComplaintFilters, 250));

  const filterBureau = document.getElementById('filterBureau');
  if (filterBureau) filterBureau.addEventListener('change', applyComplaintFilters);

  const filterCategory = document.getElementById('filterCategory');
  if (filterCategory) filterCategory.addEventListener('change', applyComplaintFilters);

  const filterRegion = document.getElementById('filterRegion');
  if (filterRegion) filterRegion.addEventListener('change', applyComplaintFilters);

  const filterStatus = document.getElementById('filterStatus');
  if (filterStatus) filterStatus.addEventListener('change', applyComplaintFilters);

  const filterPriority = document.getElementById('filterPriority');
  if (filterPriority) filterPriority.addEventListener('change', applyComplaintFilters);

  const filterDateFrom = document.getElementById('filterDateFrom');
  if (filterDateFrom) filterDateFrom.addEventListener('change', applyComplaintFilters);

  const filterDateTo = document.getElementById('filterDateTo');
  if (filterDateTo) filterDateTo.addEventListener('change', applyComplaintFilters);

  const filterOverdueOnly = document.getElementById('filterOverdueOnly');
  if (filterOverdueOnly) filterOverdueOnly.addEventListener('change', applyComplaintFilters);

  const instSearch = document.getElementById('instSearchInput');
  if (instSearch) instSearch.addEventListener('input', debounce(filterInstitutions, 250));

  // Initial Data Load
  loadAllData();
});

// Utility: Debounce
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// -------------------------------------------------------------
// DATA LOADING
// -------------------------------------------------------------
async function loadAllData() {
  try {
    await Promise.all([
      fetchStats(),
      fetchComplaints(),
      fetchInstitutions(),
      fetchOverlaps(),
      fetchReports()
    ]);
  } catch (err) {
    console.error('Error during initial data fetch:', err);
    showToast('Failed to load portal data. Check server connection.', 'error');
  }
}

async function fetchStats() {
  const res = await fetch('/api/stats');
  if (!res.ok) throw new Error('Stats fetch failed');
  currentStats = await res.json();
  renderKPIs(currentStats);
  renderCharts(currentStats);
  renderDashboardOverdue(currentStats.overdueList);
  renderDashboardActivity(currentStats.recentActivity);
}

async function fetchComplaints() {
  const res = await fetch('/api/complaints');
  if (!res.ok) throw new Error('Complaints fetch failed');
  currentComplaints = await res.json();
  renderComplaintsTable(currentComplaints);
  renderDeadlineRadar(currentComplaints);
}

async function fetchInstitutions() {
  const res = await fetch('/api/institutions');
  if (!res.ok) throw new Error('Institutions fetch failed');
  currentInstitutions = await res.json();
  renderInstitutionsGrid(currentInstitutions);
  populateInstitutionDropdown(currentInstitutions);
}

async function fetchOverlaps() {
  const res = await fetch('/api/overlaps');
  if (!res.ok) throw new Error('Overlaps fetch failed');
  const data = await res.json();
  currentOverlaps = data.overlaps || [];
  renderOverlapCards(currentOverlaps);
  
  const pendingCount = currentOverlaps.filter(o => o.reviewStatus === 'PENDING_REVIEW').length;
  const badge = document.getElementById('overlapBadgeCount');
  if (badge) badge.textContent = pendingCount;
  const kpiEl = document.getElementById('kpiOverlaps');
  if (kpiEl) kpiEl.textContent = pendingCount;
  const countEl = document.getElementById('overlapDetectionCount');
  if (countEl) countEl.textContent = currentOverlaps.length;
}

async function fetchReports() {
  try {
    const res = await fetch('/api/reports');
    if (!res.ok) throw new Error('Reports fetch failed');
    currentReports = await res.json();
    renderReportsScorecards(currentReports);
  } catch (err) {
    console.error('Error fetching reports:', err);
  }
}

// -------------------------------------------------------------
// TAB NAVIGATION & KPI DIRECT JUMPS
// -------------------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('border-aicteBlue', 'text-aicteBlue');
    btn.classList.add('border-transparent', 'text-slate-500');
  });

  const selectedContent = document.getElementById(tabId);
  const selectedBtn = document.getElementById(`tabBtn-${tabId}`);
  if (selectedContent) selectedContent.classList.add('active');
  if (selectedBtn) {
    selectedBtn.classList.remove('border-transparent', 'text-slate-500');
    selectedBtn.classList.add('border-aicteBlue', 'text-aicteBlue');
  }

  // Refresh charts if dashboard tab
  if (tabId === 'dashboardTab' && currentStats) {
    renderCharts(currentStats);
  }

  lucide.createIcons();
}

/**
 * KPI Navigation Handler (Bug B Fix):
 * Directs users to the complaints registry filtered by the clicked KPI status.
 */
function navigateToComplaints(filterType) {
  // 1. Switch tab to Complaints Registry
  switchTab('complaintsTab');

  // 2. Clear general search and reset unrelated filters
  const searchInput = document.getElementById('filterSearch');
  if (searchInput) searchInput.value = '';

  const bureauSelect = document.getElementById('filterBureau');
  if (bureauSelect) bureauSelect.value = 'ALL';

  const categorySelect = document.getElementById('filterCategory');
  if (categorySelect) categorySelect.value = 'ALL';

  const regionSelect = document.getElementById('filterRegion');
  if (regionSelect) regionSelect.value = 'ALL';

  const prioritySelect = document.getElementById('filterPriority');
  if (prioritySelect) prioritySelect.value = 'ALL';

  const dateFrom = document.getElementById('filterDateFrom');
  if (dateFrom) dateFrom.value = '';

  const dateTo = document.getElementById('filterDateTo');
  if (dateTo) dateTo.value = '';

  const statusSelect = document.getElementById('filterStatus');
  const overdueCheckbox = document.getElementById('filterOverdueOnly');

  if (filterType === 'ALL') {
    if (statusSelect) statusSelect.value = 'ALL';
    if (overdueCheckbox) overdueCheckbox.checked = false;
  } else if (filterType === 'ACTIVE') {
    if (statusSelect) statusSelect.value = 'ACTIVE';
    if (overdueCheckbox) overdueCheckbox.checked = false;
  } else if (filterType === 'OVERDUE') {
    if (statusSelect) statusSelect.value = 'ALL';
    if (overdueCheckbox) overdueCheckbox.checked = true;
  } else if (filterType === 'Resolved') {
    if (statusSelect) statusSelect.value = 'Resolved';
    if (overdueCheckbox) overdueCheckbox.checked = false;
  } else if (['Submitted', 'UNDER_PROCESS', 'TRANSFERRED', 'ESCALATED'].includes(filterType)) {
    if (statusSelect) statusSelect.value = filterType;
    if (overdueCheckbox) overdueCheckbox.checked = false;
  }

  // 3. Apply the filters immediately
  applyComplaintFilters();
}

// -------------------------------------------------------------
// KPI & METRICS RENDERING
// -------------------------------------------------------------
function renderKPIs(data) {
  const { summary } = data;
  if (!summary) return;

  const kpiTotal = document.getElementById('kpiTotal');
  if (kpiTotal) kpiTotal.textContent = summary.total;

  const kpiPending = document.getElementById('kpiPending');
  if (kpiPending) kpiPending.textContent = summary.pending;

  const kpiOverdue = document.getElementById('kpiOverdue');
  if (kpiOverdue) kpiOverdue.textContent = summary.overdue;

  const overdueBadgeCount = document.getElementById('overdueBadgeCount');
  if (overdueBadgeCount) overdueBadgeCount.textContent = summary.overdue;

  const totalOverdueBadge = document.getElementById('totalOverdueBadge');
  if (totalOverdueBadge) totalOverdueBadge.textContent = `${summary.overdue} Overdue Cases`;

  const kpiResolved = document.getElementById('kpiResolved');
  if (kpiResolved) kpiResolved.textContent = summary.resolved;

  const rate = summary.total > 0 ? Math.round((summary.resolved / summary.total) * 100) : 0;
  const kpiResolvedRate = document.getElementById('kpiResolvedRate');
  if (kpiResolvedRate) kpiResolvedRate.textContent = `${rate}% closure rate`;

  // Secondary lifecycle metrics
  const kpiPendingInitial = document.getElementById('kpiPendingInitial');
  if (kpiPendingInitial) kpiPendingInitial.textContent = summary.pendingInitial ?? 0;

  const kpiUnderProcess = document.getElementById('kpiUnderProcess');
  if (kpiUnderProcess) kpiUnderProcess.textContent = summary.underProcess ?? 0;

  const kpiTransferred = document.getElementById('kpiTransferred');
  if (kpiTransferred) kpiTransferred.textContent = summary.transferred ?? 0;

  const kpiEscalated = document.getElementById('kpiEscalated');
  if (kpiEscalated) kpiEscalated.textContent = summary.escalated ?? 0;

  const overdueCard = document.getElementById('overdueCard');
  if (overdueCard) {
    if (summary.overdue > 0) {
      overdueCard.classList.add('pulse-overdue');
    } else {
      overdueCard.classList.remove('pulse-overdue');
    }
  }
}

// -------------------------------------------------------------
// CHART RENDERING (Chart.js)
// -------------------------------------------------------------
function renderCharts(data) {
  // 1. Bureau Distribution Chart
  const bureauCtx = document.getElementById('bureauChart');
  if (bureauCtx && data.bureauCounts) {
    if (bureauChartInstance) bureauChartInstance.destroy();
    
    const bureauLabels = Object.keys(data.bureauCounts);
    const bureauValues = Object.values(data.bureauCounts);
    const shortLabels = bureauLabels.map(l => l.replace(' Cell', '').replace(' (SGRC)', '').replace(' / Regional Office', ''));

    bureauChartInstance = new Chart(bureauCtx, {
      type: 'doughnut',
      data: {
        labels: shortLabels,
        datasets: [{
          data: bureauValues,
          backgroundColor: [
            '#1a4480', // Navy Blue
            '#f36c21', // Saffron
            '#0b7a40', // Green
            '#8b5cf6', // Purple
            '#e11d48', // Crimson
            '#0284c7', // Sky Blue
            '#d97706', // Amber
            '#4f46e5'  // Indigo
          ],
          borderWidth: 2,
          borderColor: '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { boxWidth: 12, font: { size: 10 } }
          }
        }
      }
    });
  }

  // 2. Grievance Category Chart
  const categoryCtx = document.getElementById('categoryChart');
  if (categoryCtx && data.categoryCounts) {
    if (categoryChartInstance) categoryChartInstance.destroy();

    const catLabels = Object.keys(data.categoryCounts);
    const catValues = Object.values(data.categoryCounts);
    const trimmedLabels = catLabels.map(l => l.length > 25 ? l.slice(0, 25) + '...' : l);

    categoryChartInstance = new Chart(categoryCtx, {
      type: 'bar',
      data: {
        labels: trimmedLabels,
        datasets: [{
          label: 'Complaints',
          data: catValues,
          backgroundColor: '#1a4480',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 10 } }
          },
          x: {
            ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 0 }
          }
        }
      }
    });
  }
}

// -------------------------------------------------------------
// DASHBOARD WATCHLIST & AUDIT LOG
// -------------------------------------------------------------
function renderDashboardOverdue(overdueList) {
  const container = document.getElementById('dashboardOverdueList');
  if (!container) return;

  if (!overdueList || overdueList.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center text-slate-400 text-xs">
        <i data-lucide="check-circle" class="w-8 h-8 text-emerald-500 mx-auto mb-2"></i>
        <span>No cases currently exceeding target resolution deadlines. Excellent SLA compliance!</span>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = overdueList.slice(0, 4).map(c => `
    <div class="p-3 bg-red-50/50 rounded-lg border border-red-200 flex items-center justify-between">
      <div class="flex-1 pr-3">
        <div class="flex items-center space-x-2">
          <span class="font-mono font-bold text-xs text-red-700">${c.id}</span>
          <span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-800">${c.priority}</span>
          <span class="text-xs font-semibold text-slate-800">${c.institution_name}</span>
        </div>
        <p class="text-xs text-slate-600 mt-0.5 truncate">${c.subject}</p>
        <div class="text-[11px] text-slate-400 mt-1">Responsible: <span class="font-medium text-slate-600">${c.bureau}</span></div>
      </div>
      <div class="text-right shrink-0">
        <span class="inline-block text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
          +${c.daysOverdue} days overdue
        </span>
        <div class="mt-2">
          <button onclick="openDrawer('${c.id}')" class="text-xs text-blue-600 hover:text-blue-800 font-semibold underline">
            Review Case
          </button>
        </div>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

function renderDashboardActivity(activity) {
  const container = document.getElementById('dashboardRecentActivity');
  if (!container) return;

  if (!activity || activity.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-slate-400">No recent activity recorded.</div>`;
    return;
  }

  container.innerHTML = activity.map(a => `
    <div class="flex items-start space-x-2.5 pb-2.5 border-b border-slate-100 last:border-0 last:pb-0">
      <div class="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <span class="font-mono font-bold text-slate-700">${a.complaint_id}</span>
          <span class="text-[10px] text-slate-400">${a.timestamp.slice(0, 16)}</span>
        </div>
        <p class="text-[11px] text-slate-600 mt-0.5">${a.remarks || a.action_type}</p>
        <span class="text-[10px] text-slate-400 italic">By ${a.actor}</span>
      </div>
    </div>
  `).join('');
}

// -------------------------------------------------------------
// COMPLAINTS MANAGEMENT TABLE & MULTI-CRITERIA FILTERS
// -------------------------------------------------------------
function renderComplaintsTable(complaints) {
  const tbody = document.getElementById('complaintsTableBody');
  const countEl = document.getElementById('filteredResultsCount');
  if (countEl) countEl.textContent = `Showing ${complaints.length} cases`;
  if (!tbody) return;

  if (complaints.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-10 text-slate-400 text-xs">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 text-slate-300"></i>
          <span>No complaints match your selected search or filter criteria.</span>
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  tbody.innerHTML = complaints.map(c => {
    // Priority badge
    let priorityClass = 'bg-slate-100 text-slate-700';
    if (c.priority === 'CRITICAL') priorityClass = 'bg-red-100 text-red-800 font-bold border border-red-200';
    else if (c.priority === 'HIGH') priorityClass = 'bg-orange-100 text-orange-800 font-semibold';
    else if (c.priority === 'MEDIUM') priorityClass = 'bg-blue-100 text-blue-800 font-medium';

    // Status badge
    let statusClass = 'bg-slate-100 text-slate-800';
    if (c.status === 'Resolved' || c.status === 'Rejected / Closed') statusClass = 'bg-emerald-100 text-emerald-800 font-semibold';
    else if (c.status === 'Notice Issued to Institute') statusClass = 'bg-amber-100 text-amber-800';
    else if (c.status === 'Under Bureau Scrutiny') statusClass = 'bg-indigo-100 text-indigo-800';
    else if (c.status === 'Hearing / Inquiry Scheduled') statusClass = 'bg-purple-100 text-purple-800 font-semibold';
    else if (c.status === 'Transferred') statusClass = 'bg-purple-50 text-purple-700 font-semibold border border-purple-200';
    else if (c.status === 'Escalated') statusClass = 'bg-rose-100 text-rose-800 font-bold border border-rose-200';

    // SLA display
    let slaBadge = `<span class="text-slate-600">${c.target_date}</span>`;
    if (c.isOverdue) {
      slaBadge = `<span class="text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded border border-red-200">Overdue (${c.target_date})</span>`;
    } else if (c.status === 'Resolved' || c.status === 'Rejected / Closed') {
      slaBadge = `<span class="text-emerald-600 font-medium">Closed</span>`;
    }

    // Linked case marker
    const linkedMarker = c.linked_group_id ? `
      <span class="inline-flex items-center text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.2 rounded font-bold ml-1" title="Linked Group: ${c.linked_group_id}">
        <i data-lucide="link" class="w-2.5 h-2.5 mr-0.5"></i> Linked
      </span>
    ` : '';

    return `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100">
        <td class="py-3 px-4 font-mono font-semibold text-blue-600 whitespace-nowrap">
          <button onclick="openDrawer('${c.id}')" class="hover:underline flex items-center">
            ${c.id}
          </button>
          ${linkedMarker}
        </td>
        <td class="py-3 px-4">
          <div class="font-medium text-slate-800 truncate max-w-xs" title="${c.institution_name}">${c.institution_name}</div>
          <div class="text-[11px] text-slate-400 font-mono">${c.institution_id} • ${c.institution_region || c.institution_state}</div>
        </td>
        <td class="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
          <span class="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-800 text-[11px]">
            ${c.bureau.replace(' (SGRC)', '').replace(' / Regional Office', '')}
          </span>
        </td>
        <td class="py-3 px-4 max-w-sm">
          <div class="font-semibold text-slate-800 line-clamp-1" title="${c.subject}">${c.subject}</div>
          <div class="text-[11px] text-slate-500">By <strong>${c.complainant_name}</strong> (${c.complainant_role})</div>
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <span class="text-xs px-2 py-0.5 rounded ${priorityClass}">${c.priority}</span>
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <span class="text-xs px-2 py-0.5 rounded ${statusClass}">${c.status}</span>
        </td>
        <td class="py-3 px-4 whitespace-nowrap text-xs">
          ${slaBadge}
        </td>
        <td class="py-3 px-4 text-right whitespace-nowrap space-x-1">
          <button onclick="openDrawer('${c.id}')" class="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-slate-100 rounded" title="View Full Dossier">
            <i data-lucide="eye" class="w-4 h-4"></i>
          </button>
          <button onclick="openEditModal('${c.id}')" class="p-1.5 text-slate-600 hover:text-amber-600 hover:bg-slate-100 rounded" title="Update / Reassign">
            <i data-lucide="edit-3" class="w-4 h-4"></i>
          </button>
          <button onclick="confirmDeleteComplaint('${c.id}')" class="p-1.5 text-slate-400 hover:text-red-600 hover:bg-slate-100 rounded" title="Delete Complaint">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

async function applyComplaintFilters() {
  const search = document.getElementById('filterSearch')?.value || '';
  const bureau = document.getElementById('filterBureau')?.value || 'ALL';
  const category = document.getElementById('filterCategory')?.value || 'ALL';
  const region = document.getElementById('filterRegion')?.value || 'ALL';
  const status = document.getElementById('filterStatus')?.value || 'ALL';
  const priority = document.getElementById('filterPriority')?.value || 'ALL';
  const dateFrom = document.getElementById('filterDateFrom')?.value || '';
  const dateTo = document.getElementById('filterDateTo')?.value || '';
  const overdueOnly = document.getElementById('filterOverdueOnly')?.checked || false;

  const params = new URLSearchParams();
  if (search.trim()) params.append('search', search.trim());
  if (bureau && bureau !== 'ALL') params.append('bureau', bureau);
  if (category && category !== 'ALL') params.append('category', category);
  if (region && region !== 'ALL') params.append('region', region);
  if (status && status !== 'ALL') params.append('status', status);
  if (priority && priority !== 'ALL') params.append('priority', priority);
  if (dateFrom) params.append('dateFrom', dateFrom);
  if (dateTo) params.append('dateTo', dateTo);
  if (overdueOnly) params.append('overdueOnly', 'true');

  try {
    const res = await fetch(`/api/complaints?${params.toString()}`);
    if (res.ok) {
      currentComplaints = await res.json();
      renderComplaintsTable(currentComplaints);
    }
  } catch (err) {
    console.error('Error applying filters:', err);
  }
}

function resetFilters() {
  const searchInput = document.getElementById('filterSearch');
  if (searchInput) searchInput.value = '';

  const bureauSelect = document.getElementById('filterBureau');
  if (bureauSelect) bureauSelect.value = 'ALL';

  const categorySelect = document.getElementById('filterCategory');
  if (categorySelect) categorySelect.value = 'ALL';

  const regionSelect = document.getElementById('filterRegion');
  if (regionSelect) regionSelect.value = 'ALL';

  const statusSelect = document.getElementById('filterStatus');
  if (statusSelect) statusSelect.value = 'ALL';

  const prioritySelect = document.getElementById('filterPriority');
  if (prioritySelect) prioritySelect.value = 'ALL';

  const dateFrom = document.getElementById('filterDateFrom');
  if (dateFrom) dateFrom.value = '';

  const dateTo = document.getElementById('filterDateTo');
  if (dateTo) dateTo.value = '';

  const overdueCheckbox = document.getElementById('filterOverdueOnly');
  if (overdueCheckbox) overdueCheckbox.checked = false;

  applyComplaintFilters();
}

// -------------------------------------------------------------
// OVERLAP DETECTION CENTRE RENDERING
// -------------------------------------------------------------
function renderOverlapCards(overlaps) {
  const container = document.getElementById('overlapCardsContainer');
  if (!container) return;

  if (!overlaps || overlaps.length === 0) {
    container.innerHTML = `
      <div class="bg-white p-8 rounded-xl border border-slate-200 text-center text-slate-400 text-sm">
        <i data-lucide="sparkles" class="w-10 h-10 text-emerald-500 mx-auto mb-2"></i>
        <h3 class="font-bold text-slate-700">No Overlapping Complaints Detected</h3>
        <p class="text-xs text-slate-500 mt-1">All complaint cases appear distinct with no cross-bureau duplication.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = overlaps.map((item, idx) => {
    const isPending = item.reviewStatus === 'PENDING_REVIEW';
    const isConfirmed = item.reviewStatus === 'CONFIRMED_RELATED';
    const isDismissed = item.reviewStatus === 'DISMISSED_DISTINCT';

    let cardBorder = 'border-purple-200';
    let badgeText = `${item.similarity}% OVERLAP`;
    let badgeStyle = 'bg-purple-100 text-purple-800 border-purple-200';

    if (item.severity === 'CRITICAL') {
      cardBorder = 'border-red-300';
      badgeStyle = 'bg-red-100 text-red-800 border-red-200 font-bold';
    }

    let statusPill = `<span class="bg-amber-100 text-amber-800 text-xs px-2.5 py-1 rounded-full font-semibold border border-amber-200 flex items-center space-x-1"><i data-lucide="clock" class="w-3.5 h-3.5"></i><span>Pending Review</span></span>`;
    if (isConfirmed) {
      statusPill = `<span class="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-1 rounded-full font-semibold border border-emerald-200 flex items-center space-x-1"><i data-lucide="check-check" class="w-3.5 h-3.5"></i><span>Verified Linked Case</span></span>`;
    } else if (isDismissed) {
      statusPill = `<span class="bg-slate-100 text-slate-600 text-xs px-2.5 py-1 rounded-full font-semibold border border-slate-200 flex items-center space-x-1"><i data-lucide="shield-x" class="w-3.5 h-3.5"></i><span>Dismissed as Distinct</span></span>`;
    }

    const keywordChips = (item.commonKeywords || []).map(k => `<span class="keyword-chip">${k}</span>`).join(' ');

    return `
      <div class="bg-white rounded-xl border ${cardBorder} shadow-sm p-5 hover:shadow-md transition">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div class="flex items-center space-x-2">
            <span class="text-xs px-2.5 py-0.5 rounded-full border ${badgeStyle}">
              ${badgeText} (${item.severity})
            </span>
            <span class="text-xs text-slate-500 font-medium">
              Target Institution: <strong class="text-slate-800">${item.complaintA.institution_name || item.complaintA.institution_id}</strong>
            </span>
          </div>
          <div>${statusPill}</div>
        </div>

        <!-- Overlap Reasons & Keywords -->
        <div class="py-3">
          <div class="text-xs text-slate-600 font-medium flex flex-wrap gap-2 mb-2">
            ${(item.reasons || []).map(r => `<span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[11px] font-medium">• ${r}</span>`).join('')}
          </div>
          ${keywordChips ? `<div class="mt-2 flex flex-wrap items-center gap-1.5"><span class="text-[11px] text-slate-400 font-semibold mr-1">Shared Tokens:</span>${keywordChips}</div>` : ''}
        </div>

        <!-- Side-by-Side Summary Row -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 my-2">
          <!-- Case A Preview -->
          <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="font-mono font-bold text-blue-600">${item.complaintA.id}</span>
              <span class="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded font-semibold">${item.complaintA.bureau}</span>
            </div>
            <h5 class="text-xs font-bold text-slate-800 line-clamp-1">${item.complaintA.subject}</h5>
            <p class="text-[11px] text-slate-600 mt-1 line-clamp-2">${item.complaintA.description}</p>
            <div class="text-[10px] text-slate-400 mt-1">Complainant: ${item.complaintA.complainant_name} (${item.complaintA.complainant_role})</div>
          </div>

          <!-- Case B Preview -->
          <div class="p-3 bg-slate-50 rounded-lg border border-slate-200">
            <div class="flex items-center justify-between text-xs mb-1">
              <span class="font-mono font-bold text-purple-600">${item.complaintB.id}</span>
              <span class="text-[10px] bg-purple-100 text-purple-800 px-1.5 py-0.2 rounded font-semibold">${item.complaintB.bureau}</span>
            </div>
            <h5 class="text-xs font-bold text-slate-800 line-clamp-1">${item.complaintB.subject}</h5>
            <p class="text-[11px] text-slate-600 mt-1 line-clamp-2">${item.complaintB.description}</p>
            <div class="text-[10px] text-slate-400 mt-1">Complainant: ${item.complaintB.complainant_name} (${item.complaintB.complainant_role})</div>
          </div>
        </div>

        <!-- Card Footer Actions -->
        <div class="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div class="text-[11px] text-slate-400">
            ${item.reviewedBy ? `Last evaluated by <strong>${item.reviewedBy}</strong>` : 'Awaiting officer examination'}
          </div>
          <button onclick="openOverlapReviewModal(${idx})" class="px-4 py-2 text-xs bg-purple-700 hover:bg-purple-800 text-white font-semibold rounded-lg shadow-sm transition flex items-center space-x-1.5">
            <i data-lucide="split" class="w-3.5 h-3.5"></i>
            <span>Inspect & Review Side-by-Side</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function openOverlapReviewModal(index) {
  const item = currentOverlaps[index];
  if (!item) return;

  activeReviewPair = item;

  // Score Bar
  const scoreBadge = document.getElementById('reviewScoreBadge');
  if (scoreBadge) scoreBadge.textContent = `${item.similarity}% Match (${item.severity})`;
  const scoreBar = document.getElementById('reviewScoreBar');
  if (scoreBar) scoreBar.style.width = `${item.similarity}%`;

  // Reasons
  const reasonsList = document.getElementById('reviewReasonsList');
  if (reasonsList) {
    reasonsList.innerHTML = (item.reasons || [])
      .map(r => `<span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-medium">${r}</span>`)
      .join('');
  }

  // Tokens
  const tokensContainer = document.getElementById('reviewTokensContainer');
  if (tokensContainer) {
    tokensContainer.innerHTML = (item.commonKeywords && item.commonKeywords.length > 0)
      ? item.commonKeywords.map(k => `<span class="keyword-chip">${k}</span>`).join(' ')
      : '<span class="text-xs text-slate-400">None extracted</span>';
  }

  // Complaint A
  document.getElementById('reviewCompAId').textContent = item.complaintA.id;
  document.getElementById('reviewCompABureau').textContent = item.complaintA.bureau;
  document.getElementById('reviewCompASubject').textContent = item.complaintA.subject;
  document.getElementById('reviewCompAName').textContent = item.complaintA.complainant_name;
  document.getElementById('reviewCompARole').textContent = item.complaintA.complainant_role;
  document.getElementById('reviewCompADesc').textContent = item.complaintA.description;
  document.getElementById('reviewCompAInst').textContent = item.complaintA.institution_id;

  // Complaint B
  document.getElementById('reviewCompBId').textContent = item.complaintB.id;
  document.getElementById('reviewCompBBureau').textContent = item.complaintB.bureau;
  document.getElementById('reviewCompBSubject').textContent = item.complaintB.subject;
  document.getElementById('reviewCompBName').textContent = item.complaintB.complainant_name;
  document.getElementById('reviewCompBRole').textContent = item.complaintB.complainant_role;
  document.getElementById('reviewCompBDesc').textContent = item.complaintB.description;
  document.getElementById('reviewCompBInst').textContent = item.complaintB.institution_id;

  // Review Notes
  const officerNotes = document.getElementById('reviewOfficerNotes');
  if (officerNotes) officerNotes.value = item.reviewerNotes || '';

  const modal = document.getElementById('overlapReviewModal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeOverlapModal() {
  const modal = document.getElementById('overlapReviewModal');
  if (modal) modal.classList.add('hidden');
  activeReviewPair = null;
}

async function submitReviewDecision(decision) {
  if (!activeReviewPair) return;

  const notes = document.getElementById('reviewOfficerNotes')?.value || '';
  const officerName = document.getElementById('reviewOfficerName')?.value || 'AICTE Review Officer';

  try {
    const res = await fetch('/api/overlaps/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        complaintAId: activeReviewPair.complaintA.id,
        complaintBId: activeReviewPair.complaintB.id,
        decision,
        notes,
        officerName
      })
    });

    if (!res.ok) throw new Error('Failed to record review');

    closeOverlapModal();
    showToast(`Decision recorded: ${decision === 'CONFIRMED_RELATED' ? 'Verified Linked Case' : 'Dismissed as Distinct'}`);
    await loadAllData();
  } catch (err) {
    console.error('Error submitting review:', err);
    showToast('Failed to record human review: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------
// INSTITUTION PROFILES & GRID
// -------------------------------------------------------------
function renderInstitutionsGrid(institutions) {
  const container = document.getElementById('institutionsGrid');
  if (!container) return;

  if (!institutions || institutions.length === 0) {
    container.innerHTML = `<div class="col-span-3 text-center text-slate-400 py-8">No institutions found.</div>`;
    return;
  }

  container.innerHTML = institutions.map(inst => {
    let riskBadge = 'bg-emerald-100 text-emerald-800';
    let riskLabel = 'Low Risk';
    if (inst.calculatedRisk >= 70) {
      riskBadge = 'bg-red-100 text-red-800 font-bold border border-red-200';
      riskLabel = 'High Watchlist';
    } else if (inst.calculatedRisk >= 40) {
      riskBadge = 'bg-amber-100 text-amber-800 font-semibold';
      riskLabel = 'Moderate Risk';
    }

    return `
      <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-2 mb-2">
            <span class="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">${inst.id}</span>
            <span class="text-xs px-2 py-0.5 rounded-full ${riskBadge}">${riskLabel}</span>
          </div>
          <h4 class="text-sm font-bold text-slate-800 line-clamp-2">${inst.name}</h4>
          <div class="text-xs text-slate-500 mt-1 flex items-center space-x-1">
            <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
            <span>${inst.district}, ${inst.state} • <strong class="text-slate-700">${inst.region || 'Region'}</strong></span>
          </div>
          <div class="text-[11px] text-slate-400 mt-0.5">${inst.type}</div>
        </div>

        <div class="mt-4 pt-3 border-t border-slate-100">
          <div class="grid grid-cols-3 gap-2 text-center text-xs mb-3">
            <div class="bg-slate-50 p-1.5 rounded">
              <span class="block text-slate-400 text-[10px] uppercase font-bold">Total</span>
              <strong class="text-slate-700 font-mono">${inst.total_cases || 0}</strong>
            </div>
            <div class="bg-amber-50 p-1.5 rounded">
              <span class="block text-amber-600 text-[10px] uppercase font-bold">Active</span>
              <strong class="text-amber-700 font-mono">${inst.active_cases || 0}</strong>
            </div>
            <div class="bg-emerald-50 p-1.5 rounded">
              <span class="block text-emerald-600 text-[10px] uppercase font-bold">Closed</span>
              <strong class="text-emerald-700 font-mono">${inst.resolved_cases || 0}</strong>
            </div>
          </div>

          <button onclick="openInstitutionModal('${inst.id}')" class="w-full py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg transition flex items-center justify-center space-x-1">
            <i data-lucide="history" class="w-3.5 h-3.5"></i>
            <span>Consolidated Grievance History</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function filterInstitutions() {
  const term = document.getElementById('instSearchInput')?.value.toLowerCase().trim() || '';
  if (!term) {
    renderInstitutionsGrid(currentInstitutions);
    return;
  }

  const filtered = currentInstitutions.filter(i => 
    i.name.toLowerCase().includes(term) ||
    i.id.toLowerCase().includes(term) ||
    i.state.toLowerCase().includes(term) ||
    i.district.toLowerCase().includes(term) ||
    (i.region && i.region.toLowerCase().includes(term))
  );
  renderInstitutionsGrid(filtered);
}

function populateInstitutionDropdown(institutions) {
  const select = document.getElementById('addInstSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Select AICTE Approved Institution...</option>';
  for (const inst of institutions) {
    const opt = document.createElement('option');
    opt.value = inst.id;
    opt.textContent = `${inst.name} (${inst.id} - ${inst.region || inst.state})`;
    select.appendChild(opt);
  }
}

async function openInstitutionModal(id) {
  try {
    const res = await fetch(`/api/institutions/${id}`);
    if (!res.ok) throw new Error('Failed to fetch institution profile');
    const data = await res.json();

    document.getElementById('instModalName').textContent = data.name;
    document.getElementById('instModalId').textContent = `AICTE Permanent ID: ${data.id}`;
    document.getElementById('instModalRegion').textContent = data.region || 'Unassigned';
    document.getElementById('instModalState').textContent = data.state;
    document.getElementById('instModalDistrict').textContent = data.district;
    document.getElementById('instModalType').textContent = data.type;
    document.getElementById('instModalRisk').textContent = `${data.risk_score} / 100`;

    const addressEl = document.getElementById('instModalAddress');
    if (addressEl) addressEl.textContent = data.address || `${data.district}, ${data.state}`;

    const list = document.getElementById('instModalHistoryList');
    if (!data.complaintHistory || data.complaintHistory.length === 0) {
      list.innerHTML = `<div class="p-4 text-center text-slate-400 text-xs">No grievances recorded against this institution.</div>`;
    } else {
      list.innerHTML = data.complaintHistory.map(c => `
        <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between">
          <div>
            <div class="flex items-center space-x-2">
              <span class="font-mono font-bold text-xs text-blue-600">${c.id}</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-700">${c.bureau}</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded bg-blue-100 text-blue-800">${c.status}</span>
            </div>
            <h5 class="text-xs font-semibold text-slate-800 mt-1">${c.subject}</h5>
            <div class="text-[10px] text-slate-400 mt-0.5">Filed by ${c.complainant_name} (${c.complainant_role}) on ${c.created_at.slice(0, 10)}</div>
          </div>
          <button onclick="closeInstModal(); openDrawer('${c.id}');" class="text-xs text-blue-600 hover:underline font-semibold shrink-0 ml-3">
            Open File →
          </button>
        </div>
      `).join('');
    }

    const modal = document.getElementById('instModal');
    if (modal) modal.classList.remove('hidden');
    lucide.createIcons();
  } catch (err) {
    showToast('Error opening institution profile: ' + err.message, 'error');
  }
}

function closeInstModal() {
  const modal = document.getElementById('instModal');
  if (modal) modal.classList.add('hidden');
}

// -------------------------------------------------------------
// DEADLINE & SLA RADAR
// -------------------------------------------------------------
function renderDeadlineRadar(complaints) {
  const overdueTbody = document.getElementById('overdueTableBody');
  const upcomingTbody = document.getElementById('upcomingTableBody');

  const overdue = complaints.filter(c => c.isOverdue).sort((a, b) => a.daysToDeadline - b.daysToDeadline);
  const upcoming = complaints
    .filter(c => !c.isOverdue && c.status !== 'Resolved' && c.status !== 'Rejected / Closed')
    .sort((a, b) => a.daysToDeadline - b.daysToDeadline);

  if (overdueTbody) {
    if (overdue.length === 0) {
      overdueTbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400 text-xs">Zero overdue complaints. All cases compliant!</td></tr>`;
    } else {
      overdueTbody.innerHTML = overdue.map(c => `
        <tr class="hover:bg-red-50/40 border-b border-slate-100">
          <td class="py-2.5 px-4 font-mono font-bold text-red-700">${c.id}</td>
          <td class="py-2.5 px-4 text-xs font-semibold text-slate-800">${c.institution_name} <span class="text-slate-400">(${c.institution_region || c.institution_state})</span></td>
          <td class="py-2.5 px-4 text-xs text-slate-600">${c.bureau}</td>
          <td class="py-2.5 px-4 text-xs text-slate-500">${c.target_date}</td>
          <td class="py-2.5 px-4 text-xs font-bold text-red-600">+${Math.abs(c.daysToDeadline)} days</td>
          <td class="py-2.5 px-4 text-xs font-medium text-slate-700">${c.status}</td>
          <td class="py-2.5 px-4 text-right">
            <button onclick="openEditModal('${c.id}')" class="text-xs bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded font-semibold transition">
              Escalate / Update
            </button>
          </td>
        </tr>
      `).join('');
    }
  }

  if (upcomingTbody) {
    if (upcoming.length === 0) {
      upcomingTbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400 text-xs">No active cases pending deadline.</td></tr>`;
    } else {
      upcomingTbody.innerHTML = upcoming.map(c => `
        <tr class="hover:bg-slate-50 border-b border-slate-100">
          <td class="py-2.5 px-4 font-mono font-semibold text-blue-600">${c.id}</td>
          <td class="py-2.5 px-4 text-xs font-semibold text-slate-800">${c.institution_name} <span class="text-slate-400">(${c.institution_region || c.institution_state})</span></td>
          <td class="py-2.5 px-4 text-xs text-slate-600">${c.bureau}</td>
          <td class="py-2.5 px-4 text-xs text-slate-500">${c.target_date}</td>
          <td class="py-2.5 px-4 text-xs font-bold ${c.daysToDeadline <= 5 ? 'text-amber-600' : 'text-slate-700'}">
            ${c.daysToDeadline} days
          </td>
          <td class="py-2.5 px-4 text-xs">${c.priority}</td>
          <td class="py-2.5 px-4 text-right">
            <button onclick="openDrawer('${c.id}')" class="text-xs text-blue-600 hover:underline font-semibold">
              Details →
            </button>
          </td>
        </tr>
      `).join('');
    }
  }

  lucide.createIcons();
}

// -------------------------------------------------------------
// MULTI-DIMENSIONAL REPORTS & SCORECARDS (SIH26264 Compliance)
// -------------------------------------------------------------
function renderReportsScorecards(reports) {
  if (!reports) return;

  // 1. Bureau Scorecard
  const bureauBody = document.getElementById('bureauScorecardBody');
  if (bureauBody && reports.bureauScorecard) {
    bureauBody.innerHTML = reports.bureauScorecard.map(b => `
      <tr class="hover:bg-slate-50 border-b border-slate-100">
        <td class="py-3 px-4 font-semibold text-slate-800">${b.bureau}</td>
        <td class="py-3 px-4 text-center font-mono font-bold">${b.total}</td>
        <td class="py-3 px-4 text-center font-mono text-emerald-600 font-bold">${b.resolved}</td>
        <td class="py-3 px-4 text-center font-mono text-amber-600">${b.active}</td>
        <td class="py-3 px-4 text-center font-mono font-bold ${b.overdue > 0 ? 'text-red-600' : 'text-slate-400'}">${b.overdue}</td>
        <td class="py-3 px-4 text-center">
          <div class="flex items-center justify-center space-x-2">
            <span class="text-xs font-bold">${b.disposalRate}%</span>
            <div class="w-16 bg-slate-200 h-1.5 rounded-full overflow-hidden">
              <div class="bg-emerald-600 h-1.5 rounded-full" style="width: ${b.disposalRate}%"></div>
            </div>
          </div>
        </td>
      </tr>
    `).join('');
  }

  // 2. Region-Wise Scorecard
  const regionBody = document.getElementById('regionScorecardBody');
  if (regionBody && reports.regionWise) {
    regionBody.innerHTML = reports.regionWise.map(r => `
      <tr class="hover:bg-slate-50 border-b border-slate-100">
        <td class="py-2.5 px-3 font-semibold text-slate-800">${r.region}</td>
        <td class="py-2.5 px-3 text-center font-mono font-bold">${r.total}</td>
        <td class="py-2.5 px-3 text-center font-mono text-amber-600">${r.active}</td>
        <td class="py-2.5 px-3 text-center font-mono text-emerald-600 font-bold">${r.resolved}</td>
        <td class="py-2.5 px-3 text-center font-bold text-xs">${r.disposalRate}%</td>
      </tr>
    `).join('');
  }

  // 3. Ageing Analysis
  if (reports.ageingAnalysis) {
    const a = reports.ageingAnalysis;
    const u15 = document.getElementById('ageingUnder15');
    if (u15) u15.textContent = a.under15Days;
    const a1530 = document.getElementById('ageing15to30');
    if (a1530) a1530.textContent = a.days15to30;
    const a3060 = document.getElementById('ageing30to60');
    if (a3060) a3060.textContent = a.days30to60;
    const aOver60 = document.getElementById('ageingOver60');
    if (aOver60) aOver60.textContent = a.over60Days;
  }

  // 4. Overlap Stats
  if (reports.overlapStats) {
    const o = reports.overlapStats;
    const fl = document.getElementById('repOverlapFlagged');
    if (fl) fl.textContent = o.totalFlagged;
    const lk = document.getElementById('repOverlapLinked');
    if (lk) lk.textContent = o.confirmedLinked;
    const dis = document.getElementById('repOverlapDismissed');
    if (dis) dis.textContent = o.dismissedDistinct;
    const pnd = document.getElementById('repOverlapPending');
    if (pnd) pnd.textContent = o.pendingReview;
  }

  lucide.createIcons();
}

// -------------------------------------------------------------
// COMPLAINT DOSSIER & DRAWER
// -------------------------------------------------------------
async function openDrawer(complaintId) {
  try {
    activeDrawerComplaintId = complaintId;
    const res = await fetch(`/api/complaints/${complaintId}`);
    if (!res.ok) throw new Error('Complaint not found');
    const data = await res.json();

    // Render attached supporting documents
    renderDocumentsInDrawer(data.attachedDocuments || []);

    document.getElementById('drawerCaseId').textContent = data.id;
    document.getElementById('drawerPriorityBadge').textContent = data.priority;
    document.getElementById('drawerSubject').textContent = data.subject;
    document.getElementById('drawerStatusBadge').textContent = data.status;
    document.getElementById('drawerBureau').textContent = data.bureau;
    document.getElementById('drawerDeadline').textContent = data.isOverdue
      ? `OVERDUE (${data.target_date})`
      : data.target_date;

    const drawerOfficer = document.getElementById('drawerOfficer');
    if (drawerOfficer) drawerOfficer.textContent = data.assigned_officer || 'AICTE Desk Officer';

    const drawerLastAction = document.getElementById('drawerLastAction');
    if (drawerLastAction) drawerLastAction.textContent = data.last_action || 'Registered';

    const drawerNextAction = document.getElementById('drawerNextAction');
    if (drawerNextAction) drawerNextAction.textContent = data.next_action || 'Initial Scrutiny';

    // Institution
    document.getElementById('drawerInstName').textContent = data.institution_name;
    document.getElementById('drawerInstId').textContent = data.institution_id;
    document.getElementById('drawerInstLocation').textContent = `${data.institution_district}, ${data.institution_state}`;
    
    const instRegionEl = document.getElementById('drawerInstRegion');
    if (instRegionEl) instRegionEl.textContent = data.institution_region || data.institution_state;

    const instAddressEl = document.getElementById('drawerInstAddress');
    if (instAddressEl) instAddressEl.textContent = `Address: ${data.institution_address || 'Main Campus'}`;

    const instTypeEl = document.getElementById('drawerInstType');
    if (instTypeEl) instTypeEl.textContent = `Type: ${data.institution_type || 'Approved Institute'}`;

    document.getElementById('drawerInstRiskBadge').textContent = `Risk: ${data.institution_risk_score || 50}/100`;

    // Complainant
    document.getElementById('drawerCompName').textContent = data.complainant_name;
    document.getElementById('drawerCompRole').textContent = data.complainant_role;
    document.getElementById('drawerCompEmail').textContent = data.complainant_email || 'Not provided';
    document.getElementById('drawerCompPhone').textContent = data.complainant_phone || 'Not provided';
    document.getElementById('drawerCreatedAt').textContent = data.created_at;

    // Description
    document.getElementById('drawerDescription').textContent = data.description;

    // Resolution Remarks
    const resBox = document.getElementById('drawerResolutionBox');
    if (data.resolution_remarks) {
      document.getElementById('drawerResolutionText').textContent = data.resolution_remarks;
      resBox.classList.remove('hidden');
    } else {
      resBox.classList.add('hidden');
    }

    // Linked Banner
    const linkedBanner = document.getElementById('drawerLinkedBanner');
    if (data.linked_group_id) {
      document.getElementById('drawerGroupId').textContent = data.linked_group_id;
      linkedBanner.classList.remove('hidden');
    } else {
      linkedBanner.classList.add('hidden');
    }

    // Overlap Alert in Drawer
    const overlapAlert = document.getElementById('drawerOverlapAlert');
    const overlapList = document.getElementById('drawerOverlapPairsList');
    if (data.potentialOverlaps && data.potentialOverlaps.length > 0) {
      overlapList.innerHTML = data.potentialOverlaps.map(o => `
        <div class="text-xs bg-white/70 p-2 rounded border border-purple-200 flex items-center justify-between">
          <div>
            <span class="font-mono font-bold text-purple-900">${o.complaint.id}</span>
            <span class="text-slate-600"> (${o.complaint.bureau})</span>
            <p class="text-[11px] text-slate-500 truncate">${o.complaint.subject}</p>
          </div>
          <span class="font-bold text-purple-700 ml-2">${o.similarity}% match</span>
        </div>
      `).join('');
      overlapAlert.classList.remove('hidden');
    } else {
      overlapAlert.classList.add('hidden');
    }

    // History Timeline
    const historyContainer = document.getElementById('drawerHistoryTimeline');
    if (data.history && data.history.length > 0) {
      historyContainer.innerHTML = data.history.map(h => `
        <div class="relative pb-2">
          <div class="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-blue-600 ring-4 ring-white"></div>
          <div class="flex items-center justify-between text-[11px]">
            <strong class="text-slate-800 uppercase">${h.action_type}</strong>
            <span class="text-slate-400">${h.timestamp}</span>
          </div>
          <p class="text-slate-700 mt-0.5">${h.remarks || ''}</p>
          <div class="text-[10px] text-slate-400 mt-0.5">Authorized by: ${h.actor}</div>
        </div>
      `).join('');
    } else {
      historyContainer.innerHTML = `<div class="text-slate-400">Initial registration recorded.</div>`;
    }

    const drawer = document.getElementById('complaintDrawer');
    if (drawer) drawer.classList.remove('translate-x-full');
    lucide.createIcons();
  } catch (err) {
    showToast('Failed to open complaint dossier: ' + err.message, 'error');
  }
}

function closeDrawer() {
  const drawer = document.getElementById('complaintDrawer');
  if (drawer) drawer.classList.add('translate-x-full');
}

function printCaseDossier() {
  window.print();
}

// -------------------------------------------------------------
// ADD COMPLAINT (Fixed Bug A & Validation Safeguards)
// -------------------------------------------------------------
function openAddModal() {
  const modal = document.getElementById('addModal');
  if (modal) modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeAddModal() {
  const modal = document.getElementById('addModal');
  if (modal) modal.classList.add('hidden');
}

async function submitAddComplaint(e) {
  e.preventDefault();
  const btn = document.getElementById('btnSubmitComplaint');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Registering...</span>`;
    lucide.createIcons();
  }

  // Defensive field extraction
  const instSelect = document.getElementById('addInstSelect');
  const bureauSelect = document.getElementById('addBureau');
  const categorySelect = document.getElementById('addCategory');
  const prioritySelect = document.getElementById('addPriority');
  const targetDateInput = document.getElementById('addTargetDate');
  const compNameInput = document.getElementById('addCompName');
  const compRoleSelect = document.getElementById('addCompRole');
  const compEmailInput = document.getElementById('addCompEmail');
  const compPhoneInput = document.getElementById('addCompPhone');
  const subjectInput = document.getElementById('addSubject');
  const descTextarea = document.getElementById('addDescription');
  const officerInput = document.getElementById('addAssignedOfficer');
  const docsInput = document.getElementById('addSupportingDocs');

  const payload = {
    institution_id: instSelect?.value || '',
    bureau: bureauSelect?.value || '',
    category: categorySelect?.value || '',
    priority: prioritySelect?.value || 'MEDIUM',
    target_date: targetDateInput?.value || '',
    complainant_name: compNameInput?.value?.trim() || '',
    complainant_role: compRoleSelect?.value || 'Student',
    complainant_email: compEmailInput?.value?.trim() || '',
    complainant_phone: compPhoneInput?.value?.trim() || '',
    subject: subjectInput?.value?.trim() || '',
    description: descTextarea?.value?.trim() || '',
    assigned_officer: officerInput?.value?.trim() || 'AICTE Grievance Desk Officer',
    supporting_docs: docsInput?.value?.trim() || ''
  };

  // Client-side validation check
  if (!payload.institution_id || !payload.bureau || !payload.category || !payload.priority || !payload.complainant_name || !payload.subject || !payload.description) {
    showToast('Please fill all mandatory fields (Institution, Bureau, Category, Priority, Complainant Name, Subject, Description).', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Register Complaint</span>`;
      lucide.createIcons();
    }
    return;
  }

  try {
    const res = await fetch('/api/complaints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed');

    // If an evidence document file was selected, upload it immediately
    const docFileInput = document.getElementById('addDocumentFile');
    if (docFileInput && docFileInput.files && docFileInput.files.length > 0) {
      try {
        const docForm = new FormData();
        docForm.append('document', docFileInput.files[0]);
        await fetch(`/api/complaints/${data.complaintId}/documents`, {
          method: 'POST',
          body: docForm
        });
      } catch (docErr) {
        console.warn('Document attachment warning:', docErr);
      }
    }

    // Only close modal and reset form on verified successful registration
    closeAddModal();
    const form = document.getElementById('addComplaintForm');
    if (form) form.reset();

    // Re-set default target date
    const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    if (targetDateInput) targetDateInput.value = thirtyDaysOut;

    if (data.flaggedOverlapsCount > 0) {
      showToast(`Registered as ${data.complaintId}! ⚠️ ${data.flaggedOverlapsCount} Overlapping case(s) flagged for coordination!`, 'warning');
    } else {
      showToast(`Complaint registered successfully: ${data.complaintId}`);
    }

    // Refresh all views immediately
    await loadAllData();
  } catch (err) {
    console.error('Error creating complaint:', err);
    showToast('Error registering grievance: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>Register Complaint</span>`;
      lucide.createIcons();
    }
  }
}

// -------------------------------------------------------------
// EDIT / REASSIGN COMPLAINT
// -------------------------------------------------------------
async function openEditModal(complaintId) {
  try {
    const res = await fetch(`/api/complaints/${complaintId}`);
    if (!res.ok) throw new Error('Complaint not found');
    const data = await res.json();

    document.getElementById('editComplaintId').value = data.id;
    document.getElementById('editCaseIdBadge').textContent = data.id;
    document.getElementById('editStatus').value = data.status;
    document.getElementById('editBureau').value = data.bureau;
    document.getElementById('editPriority').value = data.priority;
    document.getElementById('editTargetDate').value = data.target_date;
    document.getElementById('editRemarks').value = data.resolution_remarks || '';

    const officerInput = document.getElementById('editAssignedOfficer');
    if (officerInput) officerInput.value = data.assigned_officer || '';

    const nextActionInput = document.getElementById('editNextAction');
    if (nextActionInput) nextActionInput.value = data.next_action || '';

    const docsInput = document.getElementById('editSupportingDocs');
    if (docsInput) docsInput.value = data.supporting_docs || '';

    const modal = document.getElementById('editModal');
    if (modal) modal.classList.remove('hidden');
    lucide.createIcons();
  } catch (err) {
    showToast('Failed to load complaint for editing: ' + err.message, 'error');
  }
}

function closeEditModal() {
  const modal = document.getElementById('editModal');
  if (modal) modal.classList.add('hidden');
}

async function submitEditComplaint(e) {
  e.preventDefault();
  const id = document.getElementById('editComplaintId')?.value;
  if (!id) return;

  const payload = {
    status: document.getElementById('editStatus')?.value,
    bureau: document.getElementById('editBureau')?.value,
    priority: document.getElementById('editPriority')?.value,
    target_date: document.getElementById('editTargetDate')?.value,
    resolution_remarks: document.getElementById('editRemarks')?.value,
    officer_name: document.getElementById('editOfficer')?.value,
    assigned_officer: document.getElementById('editAssignedOfficer')?.value,
    next_action: document.getElementById('editNextAction')?.value,
    supporting_docs: document.getElementById('editSupportingDocs')?.value
  };

  try {
    const res = await fetch(`/api/complaints/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Failed to update case');

    closeEditModal();
    showToast(`Case ${id} updated successfully`);
    await loadAllData();
  } catch (err) {
    showToast('Error saving updates: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------
// DELETE COMPLAINT
// -------------------------------------------------------------
async function confirmDeleteComplaint(complaintId) {
  if (!confirm(`Are you sure you want to delete complaint ${complaintId}? This action will permanently remove the record and its audit trail.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/complaints/${complaintId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete complaint');

    showToast(`Complaint ${complaintId} deleted`);
    await loadAllData();
  } catch (err) {
    showToast('Error deleting complaint: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------
// CSV EXPORT (Enhanced Multi-Dimensional Export)
// -------------------------------------------------------------
function exportToCSV() {
  if (!currentComplaints || currentComplaints.length === 0) {
    showToast('No complaint data available for export', 'error');
    return;
  }

  const headers = [
    'Complaint_ID',
    'Institution_ID',
    'Institution_Name',
    'AICTE_Region',
    'State',
    'District',
    'Bureau',
    'Category',
    'Priority',
    'Status',
    'Complainant_Name',
    'Complainant_Role',
    'Complainant_Email',
    'Complainant_Phone',
    'Subject',
    'Target_SLA_Date',
    'Is_Overdue',
    'Assigned_Officer',
    'Last_Action',
    'Next_Action',
    'Linked_Group_ID',
    'Created_Date'
  ];

  const rows = currentComplaints.map(c => [
    `"${c.id}"`,
    `"${c.institution_id}"`,
    `"${(c.institution_name || '').replace(/"/g, '""')}"`,
    `"${c.institution_region || c.institution_state || ''}"`,
    `"${c.institution_state || ''}"`,
    `"${c.institution_district || ''}"`,
    `"${c.bureau}"`,
    `"${c.category}"`,
    `"${c.priority}"`,
    `"${c.status}"`,
    `"${c.complainant_name}"`,
    `"${c.complainant_role}"`,
    `"${c.complainant_email || ''}"`,
    `"${c.complainant_phone || ''}"`,
    `"${(c.subject || '').replace(/"/g, '""')}"`,
    `"${c.target_date}"`,
    c.isOverdue ? 'YES' : 'NO',
    `"${(c.assigned_officer || '').replace(/"/g, '""')}"`,
    `"${(c.last_action || '').replace(/"/g, '""')}"`,
    `"${(c.next_action || '').replace(/"/g, '""')}"`,
    `"${c.linked_group_id || ''}"`,
    `"${c.created_at}"`
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `AICTE_Grievance_Master_Report_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('AICTE Grievance CSV exported successfully');
}

// -------------------------------------------------------------
// RESET DEMO DATA
// -------------------------------------------------------------
async function confirmResetDemo() {
  if (!confirm('Restore initial realistic synthetic demo dataset for SIH presentation? Any custom complaints created during testing will be reset to default demo data.')) {
    return;
  }

  try {
    const res = await fetch('/api/reset-demo', { method: 'POST' });
    if (!res.ok) throw new Error('Reset failed');

    showToast('Synthetic demo dataset restored successfully!');
    await loadAllData();
  } catch (err) {
    showToast('Failed to reset demo dataset: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------
// TOAST NOTIFICATIONS
// -------------------------------------------------------------
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const msg = document.getElementById('toastMessage');
  const icon = document.getElementById('toastIcon');
  if (!toast || !msg || !icon) return;

  msg.textContent = message;
  toast.classList.remove('translate-y-20', 'opacity-0');

  if (type === 'error') {
    toast.className = 'fixed bottom-5 right-5 z-50 bg-red-800 text-white text-xs sm:text-sm px-4 py-3 rounded-xl shadow-lg border border-red-700 flex items-center space-x-2 transition-all duration-300';
    icon.setAttribute('data-lucide', 'alert-circle');
  } else if (type === 'warning') {
    toast.className = 'fixed bottom-5 right-5 z-50 bg-amber-800 text-white text-xs sm:text-sm px-4 py-3 rounded-xl shadow-lg border border-amber-700 flex items-center space-x-2 transition-all duration-300';
    icon.setAttribute('data-lucide', 'alert-triangle');
  } else {
    toast.className = 'fixed bottom-5 right-5 z-50 bg-navy-800 text-white text-xs sm:text-sm px-4 py-3 rounded-xl shadow-lg border border-slate-700 flex items-center space-x-2 transition-all duration-300';
    icon.setAttribute('data-lucide', 'check-circle');
  }

  lucide.createIcons();

  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 4500);
}

// -------------------------------------------------------------
// STAGE 1: AUTHENTICATION & ROLE-BASED ACCESS CONTROL
// -------------------------------------------------------------
async function initAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
    } else {
      // Auto-authenticate as Central Admin for instant seamless evaluation
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin@aicte.gov.in', password: 'aicte@admin2026' })
      });
      if (loginRes.ok) {
        const loginData = await loginRes.json();
        currentUser = loginData.user;
      }
    }
    updateUserUI();
    initRealtimeStream();
  } catch (err) {
    console.error('Auth initialization error:', err);
  }
}

function updateUserUI() {
  if (!currentUser) return;
  const nameEl = document.getElementById('activeUserFullName');
  const roleEl = document.getElementById('activeUserRoleBadge');
  if (nameEl) nameEl.textContent = currentUser.fullName;
  if (roleEl) {
    if (currentUser.role === 'ADMIN') {
      roleEl.textContent = 'ADMIN • AICTE Headquarters';
      roleEl.className = 'text-[10px] text-amber-400 font-medium';
    } else if (currentUser.role === 'BUREAU_OFFICER') {
      roleEl.textContent = `BUREAU OFFICER • ${currentUser.bureau}`;
      roleEl.className = 'text-[10px] text-purple-300 font-medium';
    } else {
      roleEl.textContent = 'STUDENT • Complainant Portal';
      roleEl.className = 'text-[10px] text-emerald-300 font-medium';
    }
  }

  // Adjust role visibility
  const resetBtn = document.getElementById('btnResetDemo');
  if (resetBtn) {
    resetBtn.style.display = currentUser.role === 'ADMIN' ? 'inline-flex' : 'none';
  }

  // If student, adjust complainant form fields
  const compRoleSelect = document.getElementById('addCompRole');
  if (compRoleSelect && currentUser.role === 'GUEST_STUDENT') {
    compRoleSelect.value = 'Student';
    compRoleSelect.disabled = true;
    const nameInput = document.getElementById('addCompName');
    if (nameInput) {
      nameInput.value = currentUser.fullName;
      nameInput.readOnly = true;
    }
    const emailInput = document.getElementById('addCompEmail');
    if (emailInput) {
      emailInput.value = currentUser.email;
      emailInput.readOnly = true;
    }
  } else if (compRoleSelect) {
    compRoleSelect.disabled = false;
    const nameInput = document.getElementById('addCompName');
    if (nameInput) nameInput.readOnly = false;
    const emailInput = document.getElementById('addCompEmail');
    if (emailInput) emailInput.readOnly = false;
  }
}

function openRoleSwitcherModal() {
  const m = document.getElementById('roleModal');
  if (m) m.classList.remove('hidden');
}

function closeRoleSwitcherModal() {
  const m = document.getElementById('roleModal');
  if (m) m.classList.add('hidden');
}

async function loginAsPreset(username, password) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    currentUser = data.user;
    updateUserUI();
    closeRoleSwitcherModal();
    showToast(`Session switched to: ${currentUser.fullName} (${currentUser.role})`);
    
    // Re-establish SSE and refresh data
    initRealtimeStream();
    await loadAllData();
  } catch (err) {
    showToast('Failed to switch role: ' + err.message, 'error');
  }
}

async function submitCustomLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;
  if (!username || !password) return;
  await loginAsPreset(username, password);
}

// -------------------------------------------------------------
// STAGE 2: SUPPORTING DOCUMENT MANAGEMENT
// -------------------------------------------------------------
async function fetchComplaintDocuments(complaintId) {
  try {
    const res = await fetch(`/api/complaints/${complaintId}/documents`);
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    return [];
  }
}

function renderDocumentsInDrawer(docs) {
  const container = document.getElementById('drawerDocsContainer');
  const badge = document.getElementById('drawerDocsBadge');
  if (badge) badge.textContent = `${docs.length} Attachment${docs.length === 1 ? '' : 's'}`;

  if (!container) return;

  if (docs.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-400 italic py-1">No attachments uploaded for this case yet.</div>`;
    return;
  }

  container.innerHTML = docs.map(d => {
    const sizeKb = Math.round(d.file_size / 1024);
    const isPdf = d.mime_type === 'application/pdf';
    const icon = isPdf ? 'file-text' : 'image';
    return `
      <div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
        <div class="flex items-center space-x-2.5 overflow-hidden">
          <i data-lucide="${icon}" class="w-4 h-4 text-blue-600 shrink-0"></i>
          <div class="truncate">
            <span class="font-semibold text-slate-800 block truncate">${d.original_filename}</span>
            <span class="text-[10px] text-slate-400">${sizeKb} KB • Uploaded by ${d.uploaded_by}</span>
          </div>
        </div>
        <div class="flex items-center space-x-1.5 shrink-0 ml-2">
          <a href="/api/documents/${d.id}/view" target="_blank" class="px-2 py-1 bg-white hover:bg-slate-100 text-blue-700 border border-slate-200 rounded font-medium text-[11px] flex items-center space-x-1" title="View Document Inline">
            <i data-lucide="eye" class="w-3 h-3"></i>
            <span>View</span>
          </a>
          <a href="/api/documents/${d.id}/download" class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded font-medium text-[11px] flex items-center space-x-1" title="Download Document">
            <i data-lucide="download" class="w-3 h-3"></i>
            <span>Download</span>
          </a>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

async function uploadDrawerDocument() {
  if (!activeDrawerComplaintId) return;
  const fileInput = document.getElementById('drawerUploadInput');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast('Please select a PDF or image file to attach.', 'warning');
    return;
  }

  const file = fileInput.files[0];
  const form = new FormData();
  form.append('document', file);

  try {
    const res = await fetch(`/api/complaints/${activeDrawerComplaintId}/documents`, {
      method: 'POST',
      body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    showToast(`Document attached successfully: ${file.name}`);
    fileInput.value = '';

    // Refresh documents in drawer
    const docs = await fetchComplaintDocuments(activeDrawerComplaintId);
    renderDocumentsInDrawer(docs);
  } catch (err) {
    showToast('Document upload error: ' + err.message, 'error');
  }
}

// -------------------------------------------------------------
// STAGE 3: REAL-TIME SERVER-SENT EVENTS (SSE)
// -------------------------------------------------------------
function initRealtimeStream() {
  if (eventSource) {
    eventSource.close();
  }

  try {
    eventSource = new EventSource('/api/events');

    eventSource.addEventListener('connected', () => {
      const ind = document.getElementById('sseIndicator');
      if (ind) ind.classList.remove('opacity-50');
    });

    eventSource.addEventListener('COMPLAINT_CREATED', (e) => {
      const data = JSON.parse(e.data);
      showToast(`📢 Real-time: New complaint ${data.id} filed (${data.bureau})`, 'info');
      fetchStats();
      fetchComplaints();
    });

    eventSource.addEventListener('COMPLAINT_UPDATED', (e) => {
      const data = JSON.parse(e.data);
      showToast(`⚡ Real-time: Case ${data.id} updated (${data.status})`, 'info');
      fetchStats();
      fetchComplaints();
    });

    eventSource.addEventListener('DOCUMENT_UPLOADED', (e) => {
      const data = JSON.parse(e.data);
      if (activeDrawerComplaintId === data.complaintId) {
        fetchComplaintDocuments(data.complaintId).then(renderDocumentsInDrawer);
      }
    });

    eventSource.addEventListener('OVERLAP_REVIEWED', () => {
      showToast('⚖️ Real-time: Cross-bureau overlap determination recorded', 'info');
      fetchOverlaps();
    });

    eventSource.onerror = () => {
      const ind = document.getElementById('sseIndicator');
      if (ind) ind.classList.add('opacity-50');
    };
  } catch (err) {
    console.warn('Real-time SSE not supported or blocked:', err);
  }
}

// -------------------------------------------------------------
// STAGE 4: CONFIGURABLE NOTIFICATIONS & SLA SCANS
// -------------------------------------------------------------
function openNotificationLogsModal() {
  const m = document.getElementById('notificationModal');
  if (m) m.classList.remove('hidden');
  loadNotificationLogs();
}

function closeNotificationLogsModal() {
  const m = document.getElementById('notificationModal');
  if (m) m.classList.add('hidden');
}

async function loadNotificationLogs() {
  const container = document.getElementById('notificationLogsContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/notifications');
    if (!res.ok) {
      if (res.status === 403) {
        container.innerHTML = `<div class="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">Notification audit logs are restricted to Central Administrator role.</div>`;
        return;
      }
      throw new Error('Failed to load notification logs');
    }
    const logs = await res.json();

    if (logs.length === 0) {
      container.innerHTML = `<div class="text-xs text-slate-400 italic p-3">No notification records found in database.</div>`;
      return;
    }

    container.innerHTML = logs.map(l => {
      const isSim = l.status === 'SIMULATED_LOCAL';
      const badgeClass = isSim ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800';
      return `
        <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
          <div class="flex items-center justify-between">
            <span class="font-bold text-navy-800 uppercase tracking-wide text-[11px]">${l.event_type}</span>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeClass}">${l.status}</span>
          </div>
          <div class="text-slate-600">Case ID: <span class="font-mono font-semibold">${l.complaint_id}</span> • Channel: <strong>${l.channel}</strong></div>
          <div class="text-[11px] text-slate-500">${l.provider_response || ''}</div>
          <div class="text-[10px] text-slate-400">Timestamp: ${l.created_at}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-xs text-red-600 p-2">Error: ${err.message}</div>`;
  }
}

async function triggerSlaCheck() {
  try {
    const res = await fetch('/api/notifications/check-sla', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to trigger SLA scan');
    showToast(`SLA Scan Complete: ${data.triggeredCount} active alerts evaluated!`);
    loadNotificationLogs();
  } catch (err) {
    showToast('SLA scan failed: ' + err.message, 'error');
  }
}
