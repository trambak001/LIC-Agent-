import streamlit as st
import pandas as pd
import urllib.parse


st.set_page_config(page_title="LIC Agent Smart Reminders", layout="wide")
st.title("📊 LIC Client Premium Reminder Dashboard")
st.write("Upload your monthly LIC due list (Excel, CSV, or PDF) to quickly ping clients.")


# ── Column-mapping config ─────────────────────────────────────────
# Each standard column has a priority-ordered list of aliases (lowercase).
# The first alias found in the uploaded file wins.
COLUMN_ALIASES = {
    'Client Name':    ['name of assured', 'client name', 'name', 'assured name'],
    'Policy Number':  ['policyno', 'policy number', 'policy no', 'policy_number'],
    'Premium Amount': ['totprem', 'total premium', 'premium amount', 'instprem'],
    'Due Date':       ['fup', 'due date', 'due_date', 'premium due date'],
    'Phone Number':   ['phone number', 'phone', 'mobile', 'contact', 'mobile number'],
}
REQUIRED = ['Client Name', 'Policy Number', 'Premium Amount', 'Due Date']


# ── Helpers ────────────────────────────────────────────────────────
def parse_pdf(file):
    """Extract the premium-due table from a LIC PDF."""
    import pdfplumber

    header, rows = None, []
    with pdfplumber.open(file) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for raw in table:
                    if not raw:
                        continue
                    cells = [str(c).strip().replace('\n', ' ') if c else '' for c in raw]
                    if all(c == '' for c in cells):
                        continue

                    joined = ' '.join(cells).lower()
                    # Detect header (appears on first / every page)
                    if 'policyno' in joined or ('s.no' in joined and 'name' in joined):
                        if header is None:
                            header = cells
                        continue  # skip repeated headers on later pages

                    if header and len(cells) == len(header):
                        # Keep only real data rows (S.No is numeric)
                        sno_i = next(
                            (i for i, h in enumerate(header)
                             if h.lower().replace('.', '').replace(' ', '') == 'sno'),
                            None,
                        )
                        if sno_i is not None and not cells[sno_i].replace(' ', '').isdigit():
                            continue
                        rows.append(cells)

    return pd.DataFrame(rows, columns=header) if header and rows else None


def auto_map_columns(df):
    """Map uploaded columns → standard names (case-insensitive, first match wins)."""
    df.columns = [c.strip() for c in df.columns]
    low = {c.lower(): c for c in df.columns}
    rename, used = {}, set()
    for std, aliases in COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in low and low[alias] not in used:
                rename[low[alias]] = std
                used.add(low[alias])
                break
    return df.rename(columns=rename)


# ── Main ───────────────────────────────────────────────────────────
def main():
    uploaded = st.file_uploader("Choose the LIC file", type=["xlsx", "csv", "pdf"])
    if uploaded is None:
        st.info("💡 Upload your LIC due list (Excel, CSV, or PDF) to get started.")
        return

    try:
        # 1 ── Parse ─────────────────────────────────────────────────
        ext = uploaded.name.rsplit('.', 1)[-1].lower()
        if ext == 'pdf':
            df = parse_pdf(uploaded)
            if df is None:
                st.error("Could not extract a table from this PDF.")
                return
        elif ext == 'xlsx':
            df = pd.read_excel(uploaded)
        else:
            df = pd.read_csv(uploaded)

        # 2 ── Map columns ──────────────────────────────────────────
        df = auto_map_columns(df)
        st.success(f"✅ File parsed — **{len(df)}** records found.")

        missing = [c for c in REQUIRED if c not in df.columns]
        if missing:
            st.error(f"Could not find required columns: {missing}")
            st.info(f"Columns detected: {', '.join(df.columns)}")
            return

        # 3 ── Clean data ───────────────────────────────────────────
        df['Premium Amount'] = pd.to_numeric(
            df['Premium Amount'].astype(str).str.replace(',', '').str.strip(),
            errors='coerce',
        ).fillna(0)

        has_phone = 'Phone Number' in df.columns

        # 4 ── Due-list table ───────────────────────────────────────
        st.subheader("🗓️ This Month's Due List")
        show = [c for c in REQUIRED + ['Phone Number'] if c in df.columns]
        st.dataframe(df[show], use_container_width=True)

        grouped = df.groupby('Client Name', sort=True)
        c1, c2 = st.columns(2)
        c1.metric("👤 Total Clients", len(grouped))
        c2.metric("💰 Total Premium Due", f"₹{df['Premium Amount'].sum():,.0f}")

        # 5 ── Grouped action cards ─────────────────────────────────
        st.markdown("---")
        st.subheader("📲 Action Center")

        for name, grp in grouped:
            recs = grp.to_dict('records')
            total = grp['Premium Amount'].sum()
            n = len(recs)
            tag = 'policy' if n == 1 else 'policies'

            with st.expander(f"**{name}** — {n} {tag} — ₹{total:,.0f}", expanded=False):
                st.dataframe(
                    grp[['Policy Number', 'Premium Amount', 'Due Date']],
                    hide_index=True, use_container_width=True,
                )

                # ── Build message ──────────────────────────────────
                if n == 1:
                    p = recs[0]
                    msg = (
                        f"Hi {name},\n\n"
                        f"This is a friendly reminder regarding your LIC policy "
                        f"*No. {p['Policy Number']}*.\n"
                        f"The premium of *₹{p['Premium Amount']:,.0f}* is due on "
                        f"*{p['Due Date']}*.\n\n"
                        f"Please clear the payment at the earliest to keep your "
                        f"policy active. Let me know if you need any assistance!"
                    )
                else:
                    lines = ''.join(
                        f"  {i}. Policy *No. {p['Policy Number']}* — "
                        f"₹{p['Premium Amount']:,.0f} (Due: {p['Due Date']})\n"
                        for i, p in enumerate(recs, 1)
                    )
                    msg = (
                        f"Hi {name},\n\n"
                        f"This is a friendly reminder for your "
                        f"*{n} LIC policies*:\n\n"
                        f"{lines}\n"
                        f"📌 *Total Premium: ₹{total:,.0f}*\n\n"
                        f"Please clear the payments at the earliest to keep "
                        f"your policies active. Let me know if you need any "
                        f"assistance!"
                    )

                st.text_area("Message Preview", msg, key=f"msg_{name}", height=180)

                # ── WhatsApp button ────────────────────────────────
                if has_phone:
                    phone = str(recs[0].get('Phone Number', '')).strip()
                    if phone and phone.lower() != 'nan':
                        phone = phone.replace(' ', '').replace('-', '')
                        if not phone.startswith(('+', '91')):
                            phone = f"91{phone}"
                        link = f"https://wa.me/{phone}?text={urllib.parse.quote(msg)}"
                        st.link_button(f"💬 WhatsApp {name}", link, type="primary")
                    else:
                        st.warning("No phone number for this client.")
                else:
                    st.info("📋 Copy the message above — no phone column found.")

    except Exception as e:
        st.error(f"An error occurred: {e}")
        import traceback
        st.code(traceback.format_exc())


main()