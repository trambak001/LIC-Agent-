import streamlit as st
import pandas as pd
import urllib.parse

st.set_page_config(page_title="LIC Agent Smart Reminders", layout="wide")

st.title("📊 LIC Client Premium Reminder Dashboard")
st.write("Upload your monthly LIC due list Excel sheet to quickly ping clients.")

# 1. File Uploader Component
uploaded_file = st.file_uploader("Choose the LIC Excel/CSV file", type=["xlsx", "csv"])

if uploaded_file is not None:
    # Read the data based on file type
    try:
        if uploaded_file.name.endswith('.xlsx'):
            df = pd.read_excel(uploaded_file)
        else:
            df = pd.read_csv(uploaded_file)
            
        # Normalize column names to Title Case to avoid case-mismatch issues
        df.columns = [col.strip().title() for col in df.columns]
        
        st.success("File successfully uploaded and parsed!")
        
        # --- TECHNICAL NOTE FOR YOU ---
        # Modify these column names to match exactly whatever column names 
        # are present in the actual LIC downloaded excel sheet.
        # ------------------------------
        required_cols = ['Client Name', 'Phone Number', 'Policy Number', 'Premium Amount', 'Due Date']
        
        # Check if the Excel sheet matches expected headers
        if not all(col in df.columns for col in required_cols):
            st.error(f"Error: Excel sheet must contain these exact columns: {required_cols}")
            st.info("Current Columns found: " + ", ".join(df.columns))
        else:
            st.subheader("🗓️ This Month's Due List")
            
            # Display the data cleanly to the agent
            st.dataframe(df[required_cols], use_container_width=True)
            
            st.markdown("---")
            st.subheader("📲 Action Center (Quick-Ping)")
            
            # Loop through each client row and generate action items
            for index, row in df.iterrows():
                name = str(row['Client Name'])
                phone = str(row['Phone Number']).strip()
                policy = str(row['Policy Number'])
                amount = str(row['Premium Amount'])
                due_date = str(row['Due Date'])
                
                # Format phone number for WhatsApp (e.g., adding country code if missing)
                if not phone.startswith('+') and not phone.startswith('91'):
                    phone = f"91{phone}"  # Default to India country code
                
                # Draft the template text
                msg_template = (
                    f"Hi {name},\n\n"
                    f"This is a friendly reminder regarding your LIC insurance policy *No. {policy}*.\n"
                    f"The premium of *₹{amount}* is due on *{due_date}*.\n\n"
                    f"Please clear the payment at the earliest to keep your policy active. Let me know if you need any assistance!"
                )
                
                # URL encode the text string so it works in a browser link
                encoded_msg = urllib.parse.quote(msg_template)
                wa_link = f"https://wa.me/{phone}?text={encoded_msg}"
                
                # Create a visually clean card layout for each client row
                col1, col2, col3 = st.columns([3, 3, 2])
                with col1:
                    st.markdown(f"**{name}** (Policy: {policy})")
                with col2:
                    st.markdown(f"Due: ₹{amount} on {due_date}")
                with col3:
                    # Provide an external link styled nicely that opens WhatsApp
                    st.link_button(f"💬 Send to {name}", wa_link, type="primary")
                    
    except Exception as e:
        st.error(f"An error occurred while parsing the file: {e}")
else:
    st.info("💡 Awaiting an Excel sheet upload to populate client data.")