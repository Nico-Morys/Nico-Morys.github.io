// Fetch predictions from JSON file
fetch('predictions.json')
    .then(response => response.json())
    .then(predictions => {
        const tableBody = document.querySelector("#predictions-table tbody");

        predictions.forEach(prediction => {
            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${prediction.fight}</td>
                <td>${prediction.predicted_winner}</td>
                <td>${prediction.confidence}</td>
            `;

            tableBody.appendChild(row);
        });
    })
    .catch(error => console.error("Error loading predictions:", error));