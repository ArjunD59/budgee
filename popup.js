document.getElementById('analyzeBtn').addEventListener('click', () => {
    const fileInput = document.getElementById('fileInput').files[0];
    if (!fileInput) return alert("Please upload a CSV first!");

    const reader = new FileReader();
    reader.onload = function (e) {
        const csv = e.target.result;
        const data = parseCSV(csv);
        const forecast = smartForecast(data);

        const isExtension = typeof chrome !== "undefined" && chrome.storage;
        if (isExtension) {
            getStoredGoal(goal => {
                const fallbackGoal = goal || parseFloat(document.getElementById("goalInput").value) || 1000;
                displayResults(data, forecast, fallbackGoal);
            });

        } else {
            const goal = parseFloat(document.getElementById("goalInput").value) || 1000;
            displayResults(data, forecast, goal);
        }
    };
    reader.readAsText(fileInput);
});

function smartForecast(data) {
    const today = new Date();
    const daysThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const sorted = data.sort((a, b) => new Date(a.date) - new Date(b.date));

    let weightSum = 0;
    let weightedTotal = 0;
    sorted.forEach((row, index) => {
        const weight = index + 1;
        weightSum += weight;
        weightedTotal += row.amount * weight;
    });

    return (weightedTotal / weightSum) * daysThisMonth;
}

function parseCSV(csv) {
    const lines = csv.split('\n').slice(1);
    return lines.map(line => {
        const parts = line.split(',');
        if (parts.length < 3) return null;

        const [date, category, amount] = parts;
        return {
            date: new Date(date),
            category: category?.trim(),
            amount: parseFloat(amount)
        };
    }).filter(row => row && !isNaN(row.amount));
}


function getCategoryStats(data) {
    const stats = {};
    data.forEach(row => {
        const cat = row.category;
        if (!stats[cat]) {
            stats[cat] = { total: 0, count: 0 };
        }
        stats[cat].total += row.amount;
        stats[cat].count += 1;
    });

    // Add average to each category
    for (let cat in stats) {
        stats[cat].avg = stats[cat].total / stats[cat].count;
    }

    return stats;
}

function suggestSmartCuts(stats, overAmount) {
    const entries = Object.entries(stats)
        .sort((a, b) => b[1].avg - a[1].avg); // prioritize high avg spenders

    let cutSuggestions = [];
    let accumulatedCut = 0;

    for (const [cat, info] of entries) {
        if (accumulatedCut >= overAmount) break;
        const cut = Math.min(info.total * 0.2, overAmount - accumulatedCut); // suggest cutting 20%
        if (cut > 0) {
            cutSuggestions.push({ category: cat, amount: cut });
            accumulatedCut += cut;
        }
    }

    return cutSuggestions;
}


function showAlert(message, color) {
    const resultsDiv = document.getElementById("results");
    resultsDiv.innerHTML = `<p style="color:${color};">${message}</p>`;
}

function displayResults(data, forecast, goal) {
    const resultsDiv = document.getElementById("results");
    const stats = getCategoryStats(data);

    resultsDiv.innerHTML = ''; // Clear old results

    if (forecast > goal) {
        const over = forecast - goal;
        showAlert(`⚠️ Forecast: $${forecast.toFixed(2)} — Over your $${goal} budget!`, "red");

        const suggestions = suggestSmartCuts(stats, over);
        let suggestionHtml = "<h4>Smart Suggestions</h4><ul>";
        suggestions.forEach(s => {
            suggestionHtml += `<li>Reduce <strong>${s.category}</strong> by $${s.amount.toFixed(2)}</li>`;
        });
        suggestionHtml += "</ul>";
        resultsDiv.innerHTML += suggestionHtml;
    } else {
        showAlert(`✅ Forecast: $${forecast.toFixed(2)} — You're within budget!`, "green");
    }

    // Show breakdown
    let breakdownHtml = "<hr><h3>By Category</h3><ul>";
    for (let cat in stats) {
        breakdownHtml += `<li>${cat}: $${stats[cat].total.toFixed(2)} (avg: $${stats[cat].avg.toFixed(2)})</li>`;
    }
    breakdownHtml += "</ul>";
    resultsDiv.innerHTML += breakdownHtml;

    // Render chart
    const totals = {};
    for (let cat in stats) totals[cat] = stats[cat].total;
    renderChart(totals);
}



document.getElementById("saveGoal").addEventListener("click", () => {
    const goal = parseFloat(document.getElementById("goalInput").value);
    const isExtension = typeof chrome !== "undefined" && chrome.storage;

    if (isExtension) {
        chrome.storage.sync.set({ budgetGoal: goal }, () => {
            alert("Goal saved!");
        });
    } else {
        alert("Goal saved locally (not persisted in extension storage).");
    }
});

const isExtension = typeof chrome !== "undefined" && chrome.storage;
if (isExtension) {
    chrome.storage.sync.get("budgetGoal", (data) => {
        if (data.budgetGoal) {
            document.getElementById("goalInput").value = data.budgetGoal;
        }
    });
}

function getStoredGoal(callback) {
    try {
        if (typeof chrome !== "undefined" && chrome?.storage?.sync) {
            chrome.storage.sync.get("budgetGoal", (result) => {
                if (chrome.runtime?.lastError) {
                    console.warn("Chrome storage error:", chrome.runtime.lastError.message);
                    callback(null);
                } else {
                    callback(result.budgetGoal || null);
                }
            });
        } else {
            callback(null);
        }
    } catch (err) {
        console.warn("Storage access failed:", err.message);
        callback(null);
    }
}

let chartInstance = null;

function renderChart(totals) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    const categories = Object.keys(totals);
    const amounts = Object.values(totals);

    if (chartInstance) {
        chartInstance.destroy();  // Clear the previous chart
    }

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: categories,
            datasets: [{
                label: 'Spending by Category',
                data: amounts,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                borderColor: 'rgba(141, 181, 128, 1)',
                borderWidth: 3
            }]
        },
        options: {
            scales: {
                y: { beginAtZero: true }
            },
            responsive: false
        }
    });

    document.getElementById("downloadChart").addEventListener("click", () => {
        const canvas = document.getElementById("categoryChart");
        const image = canvas.toDataURL("image/png");

        const link = document.createElement("a");
        link.href = image;
        link.download = "spending_chart.png";
        link.click();
    });

}

// Modal behavior
document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("welcomeModal");
    const closeBtn = document.getElementById("closeModal");
    const fileInput = document.getElementById("fileInput");
    const analyzeBtn = document.getElementById("analyzeBtn");

    // Disable file input and analyze button initially
    fileInput.disabled = true;
    analyzeBtn.disabled = true;

    closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
        fileInput.disabled = false;
        analyzeBtn.disabled = false;
    });
});
