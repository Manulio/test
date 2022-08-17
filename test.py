import pysftp

srv = pysftp.Connection(host="manulio.files.com", username="manuel.pallares.ferrando@gmail.com",
password="Manya100...",log="./temp/pysftp.log")

with srv.cd('test'): #chdir to public
    srv.put('tessst.txt') #upload file to nodejs/

# Closes the connection
srv.close()